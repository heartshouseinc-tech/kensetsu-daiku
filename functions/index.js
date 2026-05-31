/**
 * Firebase Functions - Claude API プロキシ
 * 大工寸法計算アプリ v6
 *
 * 構成：
 *   スマホアプリ → Firebase Functions → Anthropic API
 *
 * デプロイ：
 *   cd functions
 *   npm install
 *   firebase deploy --only functions
 *
 * 環境変数の設定（一度だけ実行）：
 *   firebase functions:secrets:set ANTHROPIC_API_KEY
 *   → プロンプトに sk-ant-... を貼り付けてEnter
 */

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const fetch = require('node-fetch');

// Anthropic APIキーをFirebase Secret Managerで管理
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

// ── CORS許可オリジン ──────────────────────────
// 本番ドメインに書き換えてください
const ALLOWED_ORIGINS = [
  'https://kensetsu-nippo.web.app',
  'https://kensetsu-nippo.firebaseapp.com',
  'https://YOUR_CUSTOM_DOMAIN.com',  // カスタムドメインがあれば
  'http://localhost:3000',            // ローカル開発用
  'http://localhost:5000',
];

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
  }
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Max-Age', '3600');
}

// ── メインFunction ───────────────────────────
exports.analyzeBlueprint = onRequest(
  {
    secrets: [ANTHROPIC_API_KEY],
    region: 'asia-northeast1',  // 東京リージョン（低レイテンシ）
    timeoutSeconds: 60,
    memory: '256MiB',
    // 認証なしで公開（必要なら Firebase App Check で保護）
    invoker: 'public',
  },
  async (req, res) => {
    setCorsHeaders(req, res);

    // プリフライトリクエスト
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    try {
      const { messages, model, mediaContent } = req.body;

      if (!messages || !Array.isArray(messages)) {
        res.status(400).json({ error: 'messages は必須です' });
        return;
      }

      // 許可するモデルのみ（コスト・セキュリティ管理）
      const ALLOWED_MODELS = [
        'claude-haiku-4-5-20251001',   // 最安・高速
        'claude-sonnet-4-20250514',    // バランス
        'claude-sonnet-4-6',           // 高精度
      ];
      const selectedModel = ALLOWED_MODELS.includes(model)
        ? model
        : 'claude-haiku-4-5-20251001'; // デフォルトは最安モデル

      // PDF/画像がある場合はmessagesに組み込む
      let processedMessages = messages;
      if (mediaContent && mediaContent.base64 && mediaContent.mediaType) {
        // ファイルサイズ制限（5MB）
        const sizeBytes = (mediaContent.base64.length * 3) / 4;
        if (sizeBytes > 5 * 1024 * 1024) {
          res.status(400).json({ error: 'ファイルサイズが5MBを超えています' });
          return;
        }
        const mediaBlock = {
          type: mediaContent.mediaType === 'application/pdf' ? 'document' : 'image',
          source: {
            type: 'base64',
            media_type: mediaContent.mediaType,
            data: mediaContent.base64,
          },
        };
        // 最後のメッセージにmediaBlockを追加
        processedMessages = messages.map((msg, i) => {
          if (i === messages.length - 1 && msg.role === 'user') {
            return {
              role: 'user',
              content: [
                mediaBlock,
                { type: 'text', text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) },
              ],
            };
          }
          return msg;
        });
      }

      // Anthropic API呼び出し
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY.value(),
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: selectedModel,
          max_tokens: 1500,
          messages: processedMessages,
        }),
      });

      const data = await anthropicRes.json();

      if (!anthropicRes.ok) {
        console.error('Anthropic API error:', data);
        res.status(anthropicRes.status).json({
          error: data.error || 'Anthropic API エラー',
        });
        return;
      }

      // トークン使用量をログ（コスト追跡用）
      if (data.usage) {
        console.log(`[analyzeBlueprint] model=${selectedModel} input=${data.usage.input_tokens} output=${data.usage.output_tokens}`);
      }

      res.status(200).json(data);

    } catch (err) {
      console.error('Functions error:', err);
      res.status(500).json({ error: 'サーバーエラー: ' + err.message });
    }
  }
);
