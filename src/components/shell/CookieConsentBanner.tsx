import styles from './CookieConsentBanner.module.css'

interface CookieConsentBannerProps {
  onAccept: () => void
  onDecline: () => void
}

export function CookieConsentBanner({ onAccept, onDecline }: CookieConsentBannerProps) {
  return (
    <div className={styles.banner} data-testid="cookie-consent-banner">
      <p className={styles.text}>
        QUAR Artist can load fonts from <strong>Google Fonts</strong> to give you more
        typography options. This will connect to Google servers.
      </p>
      <div className={styles.actions}>
        <button
          className={styles.acceptBtn}
          onClick={onAccept}
          type="button"
        >
          Allow
        </button>
        <button
          className={styles.declineBtn}
          onClick={onDecline}
          type="button"
        >
          No thanks
        </button>
      </div>
    </div>
  )
}
