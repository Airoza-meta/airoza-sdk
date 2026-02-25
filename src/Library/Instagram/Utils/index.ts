import * as crypto from 'crypto';

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const generateWebSessionId = () => {
    const s = () => Math.random().toString(36).substring(2, 8);
    return `${s()}:${s()}:${s()}`;
};

export const generateUUID = () => crypto.randomUUID();
export const generateIGDid = () => crypto.randomUUID().toUpperCase();

export const parseCookie = (cookieStr: string) => {
    const parts = cookieStr.split(';');
    const part = parts[0]?.trim();
    if (!part) return null;

    const firstEqIndex = part.indexOf('=');
    if (firstEqIndex === -1) return null;

    const key = part.substring(0, firstEqIndex).trim();
    let value = part.substring(firstEqIndex + 1).trim();

    if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
    }
    return { key, value };
};
