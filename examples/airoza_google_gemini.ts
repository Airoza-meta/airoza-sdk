/**
 * Airoza Integration with Google Gemini (AI)
 * 
 * Demonstrates using Google's Generative AI (Gemini) to 
 * drive Instagram interactions via Airoza.
 */

import axios from 'axios';
const { GoogleGenerativeAI } = require("@google/generative-ai"); // npm install @google/generative-ai

const AIROZA_BASE_URL = 'http://localhost:3000';
const AIROZA_TOKEN = 'your_airoza_token';
const GEMINI_API_KEY = 'your_gemini_api_key';

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

const airoza = axios.create({
    baseURL: AIROZA_BASE_URL,
    headers: { 'Authorization': `Bearer ${AIROZA_TOKEN}` }
});

async function runGeminiAgent() {
    console.log('[GEMINI] Initializing Airoza Node Bridge...');

    const prompt = "Generate a short, friendly Instagram comment for a photo of a high-tech robotic workstation. Use 1 emoji.";

    try {
        // 1. Generate text with Gemini
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        console.log(`[GEMINI] AI Content: "${responseText}"`);

        // 2. Post via Airoza
        const postRes = await airoza.post('/api/comment', {
            botUsername: 'your_bot',
            mediaId: 'https://instagram.com/p/Example/',
            text: responseText
        });

        if (postRes.data.status === 'success') {
            console.log('[SUCCESS] Gemini content posted to Instagram!');
        }
    } catch (e: any) {
        console.error('[GEMINI-ERROR]', e.message);
    }
}

runGeminiAgent();
