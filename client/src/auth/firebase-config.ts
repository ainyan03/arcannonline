/**
 * Firebase プロジェクト設定 (公開情報)。
 * apiKey は秘密鍵ではなくプロジェクト識別子で、クライアント同梱が前提。
 * アクセス制御は Firebase コンソールの承認済みドメインで行う。
 */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAfCPP9l5ABX-Hs9SC6BKfFQYWCiwOx8Sw',
  authDomain: 'arcannonline.firebaseapp.com',
  projectId: 'arcannonline',
  appId: '1:466720127321:web:3caf0c38b8e6b90c57b448',
} as const;

export const FIREBASE_PROJECT_ID = FIREBASE_CONFIG.projectId;
