// api/telegram.js
const TelegramBot = require('node-telegram-bot-api');
const { initializeApp } = require('firebase/app');
const { 
  getFirestore, 
    doc, 
      getDoc, 
        setDoc, 
          updateDoc, 
            increment, 
              serverTimestamp, 
                runTransaction 
                } = require('firebase/firestore');
// ------------------------------------------------------------------
// FIREBASE CONFIGURATION & INITIALIZATION
// ------------------------------------------------------------------
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
      projectId: process.env.FIREBASE_PROJECT_ID || "",
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
          messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
            appId: process.env.FIREBASE_APP_ID || ""
            };
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Initialize Telegram Bot (No Polling - Webhook mode for Serverless)
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TELEGRAM_TOKEN);

// ------------------------------------------------------------------
// DATABASE HELPER FUNCTIONS
// ------------------------------------------------------------------

/**
 * Ensures user document exists or updates profile details. Sets frontendOpened = true.
 *  */
async function createOrEnsureUser(userId, firstName, photoURL, referralId) {
  const userRef = doc(db, 'users', String(userId));
    const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) {
      // New User Setup
          await setDoc(userRef, {
                id: String(userId),
                      name: firstName || 'User',
                            photoURL: photoURL || '',
                                  coins: 0,
                                        reffer: 0,
                                              refferBy: referralId ? String(referralId) : null,
                                                    tasksCompleted: 0,
                                                          totalWithdrawals: 0,
                                                                frontendOpened: true,
                                                                      rewardGiven: false,
                                                                            createdAt: serverTimestamp()
                                                                                });
                                                                                  } else {
                                                                                      // Existing User Setup - Ensure frontendOpened is true
                                                                                          const updateData = {
                                                                                                name: firstName || 'User',
                                                                                                      frontendOpened: true
                                                                                                          };
                                                                                                              if (photoURL) updateData.photoURL = photoURL;
                                                                                                                  await updateDoc(userRef, updateData);
                                                                                                                    }
                                                                                                                    }
/**
 * One-Time Atomic Referral Reward Logic using Firestore Transactions
 *  */
async function processReferralReward(userId) {
  const userIdStr = String(userId);
    const currentUserRef = doc(db, 'users', userIdStr);
  try {
      await runTransaction(db, async (transaction) => {
            const userDoc = await transaction.get(currentUserRef);
                  if (!userDoc.exists()) return;
      const userData = userDoc.data();
      // Condition Check: frontendOpened === true, rewardGiven === false, refferBy !== null
            if (
                    userData.frontendOpened === true &&
                            userData.rewardGiven === false &&
                                    userData.refferBy &&
                                            String(userData.refferBy) !== userIdStr // Prevent self-referral
                                                  ) {
                                                          const referrerIdStr = String(userData.refferBy);
                                                                  const referrerRef = doc(db, 'users', referrerIdStr);
                                                                          const referrerDoc = await transaction.get(referrerRef);
        // 1. Mark reward as given on current user (Idempotency guarantee)
                transaction.update(currentUserRef, { rewardGiven: true });
        // 2. If referrer exists, grant coins and increment referral count
                if (referrerDoc.exists()) {
                          transaction.update(referrerRef, {
                                      coins: increment(500),
                                                  reffer: increment(1)
                                                            });
                                                                    }
        // 3. Create ledger entry in ref_rewards
                const refRewardRef = doc(db, 'ref_rewards', userIdStr);
                        transaction.set(refRewardRef, {
                                  userId: userIdStr,
                                            referrerId: referrerIdStr,
                                                      reward: 500,
                                                                createdAt: serverTimestamp()
                                                                        });
                                                                              }
                                                                                  });
                                                                                    } catch (error) {
                                                                                        console.error(`Error processing referral reward for user ${userIdStr}:`, error);
                                                                                          }
                                                                                          }
/**
 * Generic field update helper
 *  */
async function updateField(userId, field, value) {
  const userRef = doc(db, 'users', String(userId));
    await updateDoc(userRef, { [field]: value });
    }
/**
 * Generic field increment helper
 *  */
async function incrementField(userId, field, amount) {
  const userRef = doc(db, 'users', String(userId));
    await updateDoc(userRef, { [field]: increment(amount) });
    }
// ------------------------------------------------------------------
// VERCEL SERVERLESS HANDLER
// ------------------------------------------------------------------
module.exports = async (req, res) => {
  // Respond immediately to non-POST requests or pre-flight checks
    if (req.method !== 'POST') {
        return res.status(200).send('Telegram Bot Webhook Operational');
          }
  try {
      const update = req.body;
    // Validate request body containing a message
        if (update && update.message) {
              const message = update.message;
                    const text = message.text || '';
                          const chatId = message.chat.id;
                                const from = message.from;
      // Extract Telegram user info
            const userId = from.id;
                  const firstName = from.first_name || 'User';
      // Extract User Profile Photo URL if available
            let photoURL = '';
                  try {
                          const userPhotos = await bot.getUserProfilePhotos(userId, { limit: 1 });
                                  if (userPhotos && userPhotos.total_count > 0) {
                                            const fileId = userPhotos.photos[0][0].file_id;
                                                      const file = await bot.getFile(fileId);
                                                                photoURL = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
                                                                        }
                                                                              } catch (err) {
                                                                                      console.warn(`Could not fetch profile photo for user ${userId}:`, err.message);
                                                                                            }
      // Handle /start command & Extract Referral Parameter
            if (text.startsWith('/start')) {
                    const parts = text.split(' ');
                            let referralId = null;
        if (parts.length > 1 && parts[1].trim() !== '') {
                  referralId = parts[1].replace('ref', '').trim();
                          }
        // 1. Create or ensure Firestore user doc (marks frontendOpened = true)
                await createOrEnsureUser(userId, firstName, photoURL, referralId);
        // 2. Process referral reward atomically within the same request
                await processReferralReward(userId);
        // 3. Send Telegram Welcome Message Response
                const photoUrl = 'https://ibb.co/sdZHVNc1';
                        const caption = `👋 Hi! Welcome ${firstName} ⭐\n\nYaha aap tasks complete karke real rewards kama sakte ho!\n\n🔥 Daily Tasks\n🔥 Video Watch\n🔥 Mini Apps\n🔥 Referral Bonus\n🔥 Auto Wallet System\n\nReady to earn?\nTap START and your journey begins!`;
        const replyMarkup = {
                  inline_keyboard: [
                              [
                                            { text: '▶ Open App', web_app: { url: 'https://maxtro48.github.io/Telegram-Bot/' } }
                                                        ],
                                                                    [
                                                                                  { text: '📢 Channel', url: 'https://t.me/indworkearn' },
                                                                                                { text: '🌐 Community', url: 'https://t.me/indworkearn' }
                                                                                                            ]
                                                                                                                      ]
                                                                                                                              };
        // Send photo with caption and inline buttons
                await bot.sendPhoto(chatId, photoUrl, {
                          caption: caption,
                                    reply_markup: replyMarkup
                                            });
                                                  }
                                                      }
    // Acknowledge webhook execution cleanly
        return res.status(200).json({ status: 'ok' });
  } catch (error) {
      console.error('Webhook execution error:', error);
          // Return 200 to prevent Telegram from retrying failed requests continuously
              return res.status(200).json({ status: 'error', message: error.message });
                }
                };
