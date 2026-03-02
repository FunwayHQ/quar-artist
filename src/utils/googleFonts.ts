/**
 * Google Fonts integration with consent management.
 * Loading fonts from Google servers requires user consent (GDPR).
 */

const CONSENT_KEY = 'quar-google-fonts-consent'

/** Curated list of popular Google Fonts suitable for artwork/illustration. */
export const GOOGLE_FONTS_POPULAR = [
  'Abril Fatface',
  'Alegreya',
  'Anton',
  'Archivo',
  'Barlow',
  'Bebas Neue',
  'Bitter',
  'Cabin',
  'Caveat',
  'Comfortaa',
  'Cormorant Garamond',
  'Crimson Text',
  'Dancing Script',
  'DM Sans',
  'Dosis',
  'EB Garamond',
  'Exo 2',
  'Fira Sans',
  'Fredoka',
  'IBM Plex Mono',
  'IBM Plex Sans',
  'Inconsolata',
  'Inter',
  'Josefin Sans',
  'Kanit',
  'Karla',
  'Lato',
  'Libre Baskerville',
  'Lobster',
  'Lora',
  'Merriweather',
  'Montserrat',
  'Nunito',
  'Open Sans',
  'Oswald',
  'Pacifico',
  'Permanent Marker',
  'Playfair Display',
  'Poppins',
  'PT Sans',
  'PT Serif',
  'Quicksand',
  'Rajdhani',
  'Raleway',
  'Roboto',
  'Roboto Condensed',
  'Roboto Mono',
  'Rubik',
  'Sacramento',
  'Source Code Pro',
  'Source Sans 3',
  'Space Grotesk',
  'Space Mono',
  'Spectral',
  'Ubuntu',
  'Work Sans',
  'Zilla Slab',
] as const

/** Check if user has given consent to load Google Fonts. */
export function isGoogleFontsConsented(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'true'
  } catch {
    return false
  }
}

/** Check if user has explicitly declined Google Fonts. */
export function isGoogleFontsDeclined(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'false'
  } catch {
    return false
  }
}

/** Save consent decision to localStorage. */
export function setGoogleFontsConsent(allowed: boolean): void {
  try {
    localStorage.setItem(CONSENT_KEY, allowed ? 'true' : 'false')
  } catch {
    // Storage not available
  }
}

/** Set of fonts already loaded to avoid duplicate <link> elements. */
const loadedFonts = new Set<string>()

/**
 * Load a specific Google Font by injecting a <link> to Google Fonts CSS.
 * Returns a promise that resolves when the font is ready to use.
 */
export async function loadGoogleFont(family: string): Promise<void> {
  if (loadedFonts.has(family)) return

  const encoded = encodeURIComponent(family)
  const url = `https://fonts.googleapis.com/css2?family=${encoded}:ital,wght@0,400;0,700;1,400;1,700&display=swap`

  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = url

  const loaded = new Promise<void>((resolve, reject) => {
    link.onload = () => resolve()
    link.onerror = () => reject(new Error(`Failed to load font: ${family}`))
  })

  document.head.appendChild(link)
  loadedFonts.add(family)

  await loaded
  // Wait for font face to be available for canvas rendering
  try {
    await document.fonts.ready
  } catch {
    // Fallback: font may still work
  }
}

/**
 * Preload a batch of Google Fonts (used on initial consent).
 * Loads all fonts in a single CSS request for efficiency.
 */
export function preloadGoogleFonts(): void {
  const families = GOOGLE_FONTS_POPULAR
    .map((f) => `family=${encodeURIComponent(f)}:ital,wght@0,400;0,700;1,400;1,700`)
    .join('&')

  const url = `https://fonts.googleapis.com/css2?${families}&display=swap`

  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = url
  document.head.appendChild(link)

  for (const f of GOOGLE_FONTS_POPULAR) {
    loadedFonts.add(f)
  }
}
