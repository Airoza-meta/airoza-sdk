/**
 * Airoza Integration with Anthropic Claude (AI)
 * 
 * Demonstrates using Claude to generate high-quality, human-like 
 * Instagram comments via Airoza.
 */

import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk'; // npm install @anthropic-ai/sdk

const AIROZA_BASE_URL = 'http://localhost:3000';
const AIROZA_TOKEN = 'your_airoza_token';
const CLAUDE_API_KEY = 'your_claude_api_key';

const anthropic = new Anthropic({ apiKey: CLAUDE_API_KEY });

const airoza = axios.create({
    baseURL: AIROZA_BASE_URL,
    headers: { 'Authorization': `Bearer ${AIROZA_TOKEN}` }
});

async function runClaudeAgent() {
    console.log('[CLAUDE] Negotiating with Neural Node...');

    try {
        // 1. Generate text with Claude
        const msg = await anthropic.messages.create({
            model: "claude-3-opus-20240229",
            max_tokens: 100,
            messages: [{
                role: "user",
                content: "Write a casual Instagram comment for a luxury watch post. Be brief and use a '🔥' emoji."
            }],
        });

        const reply = msg.content[0].text;
        console.log(`[CLAUDE] AI Content: "${reply}"`);

        // 2. Post via Airoza
        const postRes = await airoza.post('/api/comment', {
            botUsername: 'your_bot',
            mediaId: 'https://instagram.com/p/Example/',
            text: reply
        });

        if (postRes.data.status === 'success') {
            console.log('[SUCCESS] Claude content synchronized to Instagram Node!');
        }
    } catch (e: any) {
        console.error('[CLAUDE-ERROR]', e.message);
    }
}

runClaudeAgent();
