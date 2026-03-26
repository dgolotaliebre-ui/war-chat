import { Buffer } from 'buffer';
import process from 'process';

// @ts-ignore
window.Buffer = Buffer;
// @ts-ignore
window.process = process;
// @ts-ignore
window.global = window;

console.log('[Polyfills] Node.js globals injected.');
