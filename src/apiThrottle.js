// ─── Bling API Rate-Limit Throttle ────────────────────────
// Bling API v3 allows max 3 requests per second.
// This module queues all fetch calls through a throttle so we
// never exceed that limit, avoiding 429 errors.

const MAX_REQUESTS_PER_SECOND = 3;
const INTERVAL_MS = 1000;

let queue = [];
let inFlight = 0;
let windowStart = 0;
let windowCount = 0;
let draining = false;

function drain() {
    if (draining) return;
    draining = true;

    function tick() {
        if (queue.length === 0) {
            draining = false;
            return;
        }

        const now = Date.now();

        // Reset window if a full second has passed
        if (now - windowStart >= INTERVAL_MS) {
            windowStart = now;
            windowCount = 0;
        }

        // Process as many queued requests as the window allows
        while (queue.length > 0 && windowCount < MAX_REQUESTS_PER_SECOND) {
            const { resolve, reject, url, options } = queue.shift();
            windowCount++;
            inFlight++;

            fetch(url, options)
                .then(resolve)
                .catch(reject)
                .finally(() => { inFlight--; });
        }

        if (queue.length > 0) {
            // Wait until the current window expires before processing more
            const waitMs = INTERVAL_MS - (Date.now() - windowStart);
            setTimeout(tick, Math.max(waitMs, 50));
        } else {
            draining = false;
        }
    }

    tick();
}

/**
 * Drop-in replacement for `fetch()` that queues requests so the
 * Bling API 3-req/s limit is never exceeded.
 */
export function throttledFetch(url, options) {
    return new Promise((resolve, reject) => {
        queue.push({ url, options, resolve, reject });
        drain();
    });
}
