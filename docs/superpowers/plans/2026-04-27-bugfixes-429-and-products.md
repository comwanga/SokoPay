# Bug Fixes: 429 on Invoices + Products Not Showing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two bugs: invoice endpoint returning 429 for all Railway users due to shared proxy IP, and newly created products not appearing on the homepage until cache expires.

**Architecture:** Bug 1 — change `TrustedIpExtractor` in `src/routes/mod.rs` to use the leftmost `X-Forwarded-For` entry (Railway injects the real client IP there) and fall back to allowing requests rather than returning 429 when no IP can be extracted. Bug 2 — in `ProductForm.tsx`, call `queryClient.invalidateQueries()` on all homepage product query keys after a successful create or update so the homepage always shows fresh data.

**Tech Stack:** Rust/Axum (tower_governor), React/TypeScript (@tanstack/react-query)

---

### Task 1: Fix rate limiter IP extraction for Railway

**Files:**
- Modify: `src/routes/mod.rs:45-80`

**Context:**
Railway's reverse proxy appends its own IP as the rightmost `X-Forwarded-For` entry. The current extractor uses the rightmost entry, so every user looks like the same Railway proxy IP and all share one rate-limit bucket. The fix is to use the leftmost XFF entry (the real client IP that Railway injects) and fall back to a loopback address instead of `UnableToExtractKey` so requests are never blocked by missing IP extraction.

- [ ] **Step 1: Replace the `TrustedIpExtractor` impl**

In `src/routes/mod.rs`, replace lines 45–80 with:

```rust
impl KeyExtractor for TrustedIpExtractor {
    type Key = std::net::IpAddr;

    fn extract<T>(&self, req: &axum::http::Request<T>) -> Result<Self::Key, GovernorError> {
        let headers = req.headers();

        // CF-Connecting-IP: injected by Cloudflare edge, clients cannot forge it.
        if let Some(ip) = headers
            .get("CF-Connecting-IP")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<std::net::IpAddr>().ok())
        {
            return Ok(ip);
        }

        // X-Real-IP: set by nginx via `proxy_set_header X-Real-IP $remote_addr`.
        if let Some(ip) = headers
            .get("X-Real-IP")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<std::net::IpAddr>().ok())
        {
            return Ok(ip);
        }

        // X-Forwarded-For leftmost entry: Railway (and most proxies) insert the
        // real client IP as the first entry. The rightmost entry is the proxy's
        // own IP, which is shared across all users — using it collapses all
        // clients into one rate-limit bucket, causing blanket 429s on Railway.
        if let Some(ip) = headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| {
                s.split(',')
                    .next()
                    .and_then(|ip| ip.trim().parse::<std::net::IpAddr>().ok())
            })
        {
            return Ok(ip);
        }

        // Socket peer address (only present with into_make_service_with_connect_info).
        if let Some(addr) = req
            .extensions()
            .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
        {
            return Ok(addr.0.ip());
        }

        // No IP found — fall back to loopback so the request is allowed through
        // rather than rejected. Rate limiting without an IP is better than
        // blocking all users whose IP we cannot identify.
        Ok(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST))
    }
}
```

- [ ] **Step 2: Build to confirm no compile errors**

```bash
cargo build 2>&1 | grep -E "^error"
```

Expected: no output (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/routes/mod.rs
git commit -m "Fix rate limiter: use leftmost XFF for real client IP on Railway"
```

---

### Task 2: Invalidate homepage cache after product create/update

**Files:**
- Modify: `frontend/src/components/ProductForm.tsx:1-12` (imports), `frontend/src/components/ProductForm.tsx:129-172` (mutation)

**Context:**
After a product is saved, `onSuccess` only calls `navigate('/sell')`. The homepage React Query caches (`home-new-arrivals`, `home-trending`, `home-top-picks`, `home-spotlight`) have a `staleTime` of 60 seconds. The new product is invisible on the homepage until that cache expires. Fix: invalidate all homepage product queries on success.

- [ ] **Step 1: Add `useQueryClient` import**

In `frontend/src/components/ProductForm.tsx`, change line 3 from:

```ts
import { useQuery, useMutation } from '@tanstack/react-query'
```

to:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
```

- [ ] **Step 2: Initialise `queryClient` inside the component**

In `ProductForm.tsx`, add this line right after the `const navigate = useNavigate()` line (line 31):

```ts
const queryClient = useQueryClient()
```

- [ ] **Step 3: Invalidate homepage queries on success**

Replace the `onSuccess` callback on the `save` mutation (line 170) from:

```ts
    onSuccess: () => navigate('/sell'),
```

to:

```ts
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['home-new-arrivals'] })
      queryClient.invalidateQueries({ queryKey: ['home-trending'] })
      queryClient.invalidateQueries({ queryKey: ['home-top-picks'] })
      queryClient.invalidateQueries({ queryKey: ['home-spotlight'] })
      navigate('/sell')
    },
```

- [ ] **Step 4: Build frontend to confirm no type errors**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (no errors).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ProductForm.tsx
git commit -m "Invalidate homepage caches after product save so new items appear immediately"
```

---

### Task 3: Push and verify

- [ ] **Step 1: Push to trigger CI and Railway deploy**

```bash
git push
```

- [ ] **Step 2: Verify fix 1 — invoice no longer returns 429**

In the Vercel app, try generating an invoice multiple times quickly. It should no longer return 429 after a few attempts.

- [ ] **Step 3: Verify fix 2 — new products appear on homepage**

Log in as a seller, create a new product, navigate to the homepage. The product should appear in "New Arrivals" immediately without needing to wait or refresh.
