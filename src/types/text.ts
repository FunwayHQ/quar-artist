export interface TextProperties {
  fontFamily: string
  fontSize: number
  fontWeight: 'normal' | 'bold'
  fontStyle: 'normal' | 'italic'
  textAlign: 'left' | 'center' | 'right'
  color: string // hex string e.g. '#FF0000'
}

export const WEB_SAFE_FONTS = [
  'Arial',
  'Verdana',
  'Helvetica',
  'Tahoma',
  'Trebuchet MS',
  'Times New Roman',
  'Georgia',
  'Courier New',
  'Impact',
  'Comic Sans MS',
] as const

export const DEFAULT_TEXT_PROPERTIES: TextProperties = {
  fontFamily: 'Arial',
  fontSize: 48,
  fontWeight: 'normal',
  fontStyle: 'normal',
  textAlign: 'left',
  color: '#FFFFFF',
}
