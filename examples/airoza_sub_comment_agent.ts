/**
 * Airoza AI Sub-Comment Monitor
 * 
 * Advanced example: Monitoring SPECIFIC comments for sub-replies
 * and engaging with them using AI.
 */

import axios from 'axios';
import OpenAI from 'openai';

const AIROZA_BASE_URL = 'http://localhost:3000';
const AIROZA_API_KEY = 'your_token';
const OPENAI_API_KEY = 'your_openai_key';
const BOT_USERNAME = 'your_bot';
const TARGET_MEDIA_ID = 'post_url';

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const airoza = axios.create({
    baseURL: AIROZA_BASE_URL,
    headers: { 'Authorization': `Bearer ${AIROZA_API_KEY}` }
});

async function monitorSubComments() {
    try {
        console.log('[MONITOR] Fetching main comments...');
        const res = await airoza.get(`/api/comments/${encodeURIComponent(TARGET_MEDIA_ID)}?botUsername=${BOT_USERNAME}`);
        const comments = res.data.comments || [];

        for (const comment of comments) {
            // Check if this comment has child replies (sub-comments)
            if (comment.child_comment_count > 0) {
                console.log(`[THREAD] Found ${comment.child_comment_count} replies on: "${comment.text}"`);

                // In a full implementation, you'd fetch child comments here.
                // For this example, we engage with the most active thread.

                const aiRes = await openai.chat.completions.create({
                    model: "gpt-3.5-turbo",
                    messages: [
                        { role: "system", content: "Join this conversation thread naturally." },
                        { role: "user", content: `Main Comment: ${comment.text}` }
                    ]
                });

                const reply = aiRes.choices[0].message.content;

                await airoza.post('/api/comment', {
                    botUsername: BOT_USERNAME,
                    mediaId: TARGET_MEDIA_ID,
                    text: reply,
                    replyToId: comment.pk
                });

                console.log('[SUCCESS] Engaged with sub-comment thread.');
            }
        }
    } catch (e: any) {
        console.error('[ERROR]', e.message);
    }
}

monitorSubComments();
