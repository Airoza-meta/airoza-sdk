import axios from 'axios';

/**
 * MailService - Handling Temporary Email via Mail.tm (100% Free)
 */
export class MailService {
    private api = 'https://api.mail.tm';
    private token: string = '';
    public address: string = '';
    private accountId: string = '';

    /**
     * Create a new temporary mailbox
     */
    async createAccount(seedName?: string) {
        console.log(`[MAIL] Provisioning free mailbox via Mail.tm...`);
        try {
            // 1. Get available domains
            const domainRes = await axios.get(`${this.api}/domains`);
            const domains = domainRes.data['hydra:member'];
            if (!domains || domains.length === 0) throw new Error('No domains available');

            // Pick a random domain instead of always the first one
            const domain = domains[Math.floor(Math.random() * domains.length)].domain;

            // 2. Generate human-like username
            let username = seedName ? seedName.replace(/[^a-z0-9]/g, '') : `user${Math.random().toString(36).substring(2, 8)}`;

            // If username is too short or doesn't look diverse, add a realistic suffix
            if (username.length < 8) {
                username += Math.floor(Math.random() * 9999);
            }

            const password = Math.random().toString(36).substring(2, 15);
            this.address = `${username}@${domain}`;

            // 3. Register the account
            const res = await axios.post(`${this.api}/accounts`, {
                address: this.address,
                password: password
            });
            this.accountId = res.data.id;

            // 4. Authenticate and get Token
            const tokenRes = await axios.post(`${this.api}/token`, {
                address: this.address,
                password: password
            });
            this.token = tokenRes.data.token;

            console.log(`[MAIL] Free Mailbox Ready:`);
            console.log(`       Address: ${this.address}`);
            console.log(`       Password: ${password}`);
            return this.address;
        } catch (e: any) {
            console.error(`[MAIL] Mail.tm Error:`, e.response?.data || e.message);
            throw new Error('Failed to provision free mailbox');
        }
    }

    /**
     * Poll for Instagram OTP code
     */
    async waitForOTP(timeoutMs: number = 120000): Promise<string | null> {
        const now = new Date();
        // Add 60s grace period for clock drift (important!)
        const startTime = new Date(now.getTime() - 60000);

        console.log(`[MAIL] Polling ${this.address} for Instagram OTP...`);
        console.log(`       (Waiting for emails since: ${startTime.toLocaleTimeString()})`);

        const pollStart = Date.now();
        while (Date.now() - pollStart < timeoutMs) {
            const elapsed = Math.floor((Date.now() - pollStart) / 1000);

            try {
                const res = await axios.get(`${this.api}/messages`, {
                    headers: { Authorization: `Bearer ${this.token}` }
                });

                const messages = res.data['hydra:member'];
                if (Array.isArray(messages) && messages.length > 0) {
                    for (const msg of messages) {
                        const msgTime = new Date(msg.createdAt);

                        // Check if sender is Instagram
                        const from = msg.from.address.toLowerCase();
                        const subject = msg.subject || '';

                        if (from.includes('instagram.com')) {
                            // Only check time if it's definitely an Instagram email
                            if (msgTime < startTime) {
                                console.log(`[MAIL] Skipping Instagram email from ${msgTime.toLocaleTimeString()} (Too old)`);
                                continue;
                            }

                            console.log(`[MAIL] New Instagram email detected (${elapsed}s elapsed): "${subject}"`);

                            const detailRes = await axios.get(`${this.api}/messages/${msg.id}`, {
                                headers: { Authorization: `Bearer ${this.token}` }
                            });

                            const body = detailRes.data.text || detailRes.data.html || detailRes.data.intro || '';
                            console.log(`[MAIL] --- FULL EMAIL BODY START ---`);
                            console.log(body);
                            console.log(`[MAIL] --- FULL EMAIL BODY END ---`);

                            const bodyMatch = body.match(/\b(\d{3})\s?(\d{3})\b/);
                            if (bodyMatch) {
                                const code = bodyMatch[1] + (bodyMatch[2] || '');
                                console.log(`[MAIL] Success! Captured Code: ${code}`);
                                return code;
                            }
                        } else {
                            console.log(`[MAIL] Skipping non-Instagram email from: ${from}`);
                        }
                    }
                }
            } catch (e: any) { }

            if (elapsed > 0 && elapsed % 10 === 0) {
                console.log(`[MAIL] Still waiting for OTP... (${elapsed}s)`);
            }

            // Faster poll: 2 seconds
            await new Promise(r => setTimeout(r, 2000));
        }

        console.warn(`[MAIL] Timeout: No Instagram OTP received in ${timeoutMs / 1000}s.`);
        return null;
    }
}
