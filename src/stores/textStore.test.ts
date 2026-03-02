import { describe, it, expect, beforeEach } from 'vitest'
import { useTextStore } from './textStore.ts'

describe('textStore', () => {
  beforeEach(() => {
    useTextStore.setState({
      properties: {
        fontFamily: 'Arial',
        fontSize: 48,
        fontWeight: 'normal',
        fontStyle: 'normal',
        textAlign: 'left',
        color: '#FFFFFF',
      },
      isEditing: false,
      editPosition: null,
    })
  })

  it('has correct defaults', () => {
    const s = useTextStore.getState()
    expect(s.properties.fontFamily).toBe('Arial')
    expect(s.properties.fontSize).toBe(48)
    expect(s.properties.fontWeight).toBe('normal')
    expect(s.properties.fontStyle).toBe('normal')
    expect(s.properties.textAlign).toBe('left')
    expect(s.isEditing).toBe(false)
    expect(s.editPosition).toBeNull()
  })

  it('sets fontFamily', () => {
    useTextStore.getState().setFontFamily('Georgia')
    expect(useTextStore.getState().properties.fontFamily).toBe('Georgia')
  })

  it('sets fontSize with minimum of 1', () => {
    useTextStore.getState().setFontSize(72)
    expect(useTextStore.getState().properties.fontSize).toBe(72)

    useTextStore.getState().setFontSize(0)
    expect(useTextStore.getState().properties.fontSize).toBe(1)
  })

  it('sets fontWeight', () => {
    useTextStore.getState().setFontWeight('bold')
    expect(useTextStore.getState().properties.fontWeight).toBe('bold')
  })

  it('sets fontStyle', () => {
    useTextStore.getState().setFontStyle('italic')
    expect(useTextStore.getState().properties.fontStyle).toBe('italic')
  })

  it('sets textAlign', () => {
    useTextStore.getState().setTextAlign('center')
    expect(useTextStore.getState().properties.textAlign).toBe('center')
  })

  it('sets color', () => {
    useTextStore.getState().setColor('#FF0000')
    expect(useTextStore.getState().properties.color).toBe('#FF0000')
  })

  it('sets availableFonts', () => {
    useTextStore.getState().setAvailableFonts(['Font A', 'Font B'])
    expect(useTextStore.getState().availableFonts).toEqual(['Font A', 'Font B'])
  })

  it('begins and ends editing', () => {
    useTextStore.getState().beginEditing(100, 200, 50, 60)
    const s = useTextStore.getState()
    expect(s.isEditing).toBe(true)
    expect(s.editPosition).toEqual({ screenX: 100, screenY: 200, canvasX: 50, canvasY: 60 })

    useTextStore.getState().endEditing()
    expect(useTextStore.getState().isEditing).toBe(false)
    expect(useTextStore.getState().editPosition).toBeNull()
  })
})
