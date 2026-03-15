/**
 * Credential Wallet Discovery Protocol
 *
 * A universal handshake for DID/credential wallet extensions — analogous
 * to EIP-6963 for Ethereum wallets, but for the W3C Credential Handler
 * ecosystem.
 *
 * Flow:
 *   1. Site dispatches `credential-wallet:discover` on window
 *   2. Every installed wallet extension responds with `credential-wallet:announce`
 *   3. Site collects announcements, displays wallet picker to user
 *   4. User picks a wallet → site calls `navigator.credentials.get()` (CHAPI)
 *   5. The chosen wallet's credential handler responds with the VP
 *
 * Multiple wallets can announce — the user always chooses.
 */

// ---------------------------------------------------------------------------
// Wallet identity (announced by extensions)
// ---------------------------------------------------------------------------

/** The wallet's self-description, presented during discovery */
export interface WalletAnnouncement {
  /** The wallet's own DID — eats its own dog food */
  did: string
  /** Human-readable wallet name */
  name: string
  /** Wallet icon URL (SVG or PNG, ideally 64×64) */
  icon: string
  /** Semantic version */
  version: string
  /** Supported credential protocols */
  protocols: WalletProtocol[]
  /** Who maintains this wallet */
  maintainer: WalletMaintainer
  /** Optional: homepage or docs URL */
  url?: string
}

export type WalletProtocol = 'chapi' | 'didcomm-v2' | 'oid4vp' | 'waci-didcomm'

export interface WalletMaintainer {
  /** Organization or individual name */
  name: string
  /** Maintainer's DID */
  did?: string
  /** Website */
  url?: string
}

// ---------------------------------------------------------------------------
// Event names (constants)
// ---------------------------------------------------------------------------

/** Dispatched by the site to trigger wallet discovery */
export const DISCOVER_EVENT = 'credential-wallet:discover'

/** Dispatched by each wallet extension in response */
export const ANNOUNCE_EVENT = 'credential-wallet:announce'

// ---------------------------------------------------------------------------
// Custom event detail types
// ---------------------------------------------------------------------------

export interface DiscoverDetail {
  /** Nonce to correlate discover → announce in noisy environments */
  nonce: string
}

export interface AnnounceDetail {
  /** Correlates to the discover nonce */
  nonce: string
  /** The wallet's self-description */
  wallet: WalletAnnouncement
}

// ---------------------------------------------------------------------------
// Site-side helpers
// ---------------------------------------------------------------------------

/**
 * Discover all credential wallet extensions installed in the browser.
 *
 * Dispatches the discover event and collects announcements within a timeout.
 * Extensions inject content scripts at `document_start`, so by the time a
 * Vue app mounts they are already listening.
 *
 * @param timeoutMs  How long to wait for announcements (default 800ms)
 * @returns Array of wallet announcements (may be empty)
 */
export function discoverWallets(timeoutMs = 800): Promise<WalletAnnouncement[]> {
  return new Promise((resolve) => {
    const wallets: WalletAnnouncement[] = []
    const seen = new Set<string>()
    const nonce = `cw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

    function onAnnounce(e: Event) {
      const detail = (e as CustomEvent<AnnounceDetail>).detail
      if (detail?.nonce !== nonce) return
      // Deduplicate by DID
      if (seen.has(detail.wallet.did)) return
      seen.add(detail.wallet.did)
      wallets.push(detail.wallet)
    }

    window.addEventListener(ANNOUNCE_EVENT, onAnnounce)

    // Broadcast discover
    window.dispatchEvent(new CustomEvent<DiscoverDetail>(DISCOVER_EVENT, {
      detail: { nonce },
    }))

    setTimeout(() => {
      window.removeEventListener(ANNOUNCE_EVENT, onAnnounce)
      resolve(wallets)
    }, timeoutMs)
  })
}

// ---------------------------------------------------------------------------
// Wallet-side helper (used by extensions)
// ---------------------------------------------------------------------------

/**
 * Listen for discover events and respond with the wallet's announcement.
 *
 * Call this once in the extension's content script (MAIN world).
 *
 * @param wallet  The wallet's self-description
 */
export function registerWalletHandler(wallet: WalletAnnouncement): void {
  window.addEventListener(DISCOVER_EVENT, (e: Event) => {
    const detail = (e as CustomEvent<DiscoverDetail>).detail
    if (!detail?.nonce) return

    window.dispatchEvent(new CustomEvent<AnnounceDetail>(ANNOUNCE_EVENT, {
      detail: {
        nonce: detail.nonce,
        wallet,
      },
    }))
  })
}
