import TelegramBot from 'node-telegram-bot-api';
import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  increment,
  serverTimestamp,
  runTransaction
} from 'firebase/firestore';

// ------------------------------------------------------------------
// CONFIGURATION & INITIALIZATION
// ------------------------------------------------------------------

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Initialize Telegram Bot without long-polling (Webhook mode)
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

// Firebase Client SDK Configuration from Environment Variables
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

// Singleton Firebase App & Firestore Client Initialization
const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(firebaseApp);

// ------------------------------------------------------------------
// CORE BACKEND FUNCTIONS
// ------------------------------------------------------------------

async function createOrEnsureUser(userId, firstName, photoURL, referralId) {
  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    await setDoc(userRef, {
      id: userId,
      name: firstName || 'User',
      photoURL: photoURL || '',
      coins: 0,
      reffer: 0,
      refferBy: referralId && referralId !== userId ? referralId : null,
      tasksCompleted: 0,
      totalWithdrawals: 0,
      frontendOpened: true,
      rewardGiven: false
    });
  } else {
    await updateDoc(userRef, {
      name: firstName || 'User',
      photoURL: photoURL || '',
      frontendOpened: true
    });
  }
}

async function processReferralReward(userId) {
  const userRef = doc(db, 'users', userId);
  const rewardRef = doc(db, 'ref_rewards', userId);

  await runTransaction(db, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists()) return;

    const userData = userSnap.data();

    if (
      userData.frontendOpened === true &&
      userData.rewardGiven === false &&
      userData.refferBy !== null &&
      userData.refferBy !== undefined
    ) {
      const referrerId = userData.refferBy;
      const referrerRef = doc(db, 'users', referrerId);
      const referrerSnap = await transaction.get(referrerRef);

      if (referrerSnap.exists()) {
        transaction.update(referrerRef, {
          coins: increment(500),
          reffer: increment(1)
        });
      }

      transaction.update(userRef, {
        rewardGiven: true
      });

      transaction.set(rewardRef, {
        userId: userId,
        referrerId: referrerId,
        reward: 500,
        createdAt: serverTimestamp()
      });
    }
  });
}

async function getUserPhotoUrl(userId) {
  try {
    const photos = await bot.getUserProfilePhotos(userId, { limit: 1 });
    if (photos && photos.total_count > 0) {
      const fileId = photos.photos[0][0].file_id;
      const file = await bot.getFile(fileId);
      return `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    }
  } catch (err) {
    console.error("Error fetching photo:", err.message);
  }
  return '';
}

// ------------------------------------------------------------------
// VERCEL SERVERLESS HANDLER
// ------------------------------------------------------------------

export default async function handler(req, res) {
  // If accessed directly via Browser (GET request)
  if (req.method !== 'POST') {
    return res.status(200).send('Telegram Bot Webhook is Active and Running.');
  }

  try {
    const update = req.body;

    if (!update || !update.message || !update.message.from) {
      return res.status(200).json({ status: 'ignored' });
    }

    const message = update.message;
    const fromUser = message.from;
    const userId = String(fromUser.id);
    const firstName = fromUser.first_name || 'User';
    const text = message.text || '';

    if (text.startsWith('/start')) {
      let referralId = null;
      const parts = text.split(' ');
      if (parts.length > 1) {
        const rawParam = parts[1].trim();
        referralId = rawParam.startsWith('ref') ? rawParam.replace('ref', '') : rawParam;
      }

      const photoURL = await getUserPhotoUrl(userId);
      await createOrEnsureUser(userId, firstName, photoURL, referralId);
      await processReferralReward(userId);

      const imageUrl = "https://ibb.co/sdZHVNc1";
      const caption = `👋 Hi! Welcome ${firstName} ⭐\nYaha aap tasks complete karke real rewards kama sakte ho!\n\n🔥 Daily Tasks\n🔥 Video Watch\n🔥 Mini Apps\n🔥 Referral Bonus\n🔥 Auto Wallet System\n\nReady to earn?\nTap START and your journey begins!`;

      const replyMarkup = {
        inline_keyboard: [
          [
            {
              text: "▶ Open App",
              web_app: { url: "https://maxtro48.github.io/Telegram-Bot/" }
            }
          ],
          [
            {
              text: "📢 Channel",
              url: "https://t.me/indworkearn"
            },
            {
              text: "🌐 Community",
              url: "https://t.me/indworkearn"
            }
          ]
        ]
      };

      await bot.sendPhoto(userId, imageUrl, {
        caption: caption,
        reply_markup: replyMarkup
      });
    }

    return res.status(200).json({ status: 'ok' });

  } catch (error) {
    console.error('Webhook Error:', error);
    return res.status(200).json({ status: 'error', message: error.message });
  }
}
