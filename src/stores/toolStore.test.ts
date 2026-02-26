import { describe, it, expect, beforeEach } from 'vitest'
import { useToolStore } from './toolStore.ts'

describe('toolStore', () => {
  beforeEach(() => {
    // Reset store to defaults
    useToolStore.setState({
      activeTool: 'brush',
      previousTool: 'brush',
    })
  })

  it('defaults to brush tool', () => {
    expect(useToolStore.getState().activeTool).toBe('brush')
  })

  describe('setTool', () => {
    it('changes the active tool', () => {
      useToolStore.getState().setTool('eraser')
      expect(useToolStore.getState().activeTool).toBe('eraser')
    })

    it('stores the previous tool', () => {
      useToolStore.getState().setTool('eraser')
      expect(useToolStore.getState().previousTool).toBe('brush')
    })

    it('chains tool changes correctly', () => {
      useToolStore.getState().setTool('eraser')
      useToolStore.getState().setTool('fill')
      expect(useToolStore.getState().activeTool).toBe('fill')
      expect(useToolStore.getState().previousTool).toBe('eraser')
    })
  })

  describe('pushTool / popTool', () => {
    it('pushTool temporarily switches tool', () => {
      useToolStore.getState().setTool('brush')
      useToolStore.getState().pushTool('eyedropper')
      expect(useToolStore.getState().activeTool).toBe('eyedropper')
      expect(useToolStore.getState().previousTool).toBe('brush')
    })

    it('popTool returns to previous tool', () => {
      useToolStore.getState().setTool('brush')
      useToolStore.getState().pushTool('eyedropper')
      useToolStore.getState().popTool()
      expect(useToolStore.getState().activeTool).toBe('brush')
    })
  })

  it('supports all tool types', () => {
    const tools = ['brush', 'eraser', 'smudge', 'selection', 'transform', 'fill', 'eyedropper', 'move'] as const
    for (const tool of tools) {
      useToolStore.getState().setTool(tool)
      expect(useToolStore.getState().activeTool).toBe(tool)
    }
  })
})
