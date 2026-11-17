import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TitleBar } from './TitleBar.tsx'
import { useProjectStore } from '@stores/projectStore.ts'

const service = vi.hoisted(() => ({
  goToGallery: vi.fn(async () => true),
  renameProject: vi.fn(async () => {}),
}))
vi.mock('../../io/persistence/ProjectService.ts', () => ({ projectService: service }))

describe('TitleBar', () => {
  beforeEach(() => {
    service.goToGallery.mockClear()
    service.renameProject.mockClear()
    useProjectStore.setState({ currentProjectId: null, currentProjectName: 'Untitled Project' })
  })

  it('renders the logo image with alt text', () => {
    render(<TitleBar />)
    const logo = screen.getByAltText('QUAR Artist')
    expect(logo).toBeInTheDocument()
    expect(logo.tagName).toBe('IMG')
  })

  it('renders within a header element', () => {
    render(<TitleBar />)
    const header = screen.getByRole('banner')
    expect(header).toBeInTheDocument()
  })

  it('has menu items', () => {
    render(<TitleBar />)
    expect(screen.getByText('File')).toBeInTheDocument()
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Adjustments')).toBeInTheDocument()
    expect(screen.getByText('Selection')).toBeInTheDocument()
    expect(screen.getByText('Help')).toBeInTheDocument()
  })

  it('shows project name', () => {
    render(<TitleBar />)
    // The name is an inline-editable input
    expect(screen.getByDisplayValue('Untitled Project')).toBeInTheDocument()
  })

  it('applies glass class for frosted glass effect', () => {
    render(<TitleBar />)
    const header = screen.getByRole('banner')
    expect(header.classList.contains('glass')).toBe(true)
  })

  it('goes to the Gallery through the project service, which saves first', async () => {
    const user = userEvent.setup()
    render(<TitleBar />)
    await user.click(screen.getByText('File'))
    await user.click(screen.getByRole('menuitem', { name: 'Gallery' }))
    expect(service.goToGallery).toHaveBeenCalledOnce()
  })

  it('saves from File › Save', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<TitleBar onSave={onSave} />)
    await user.click(screen.getByText('File'))
    await user.click(screen.getByRole('menuitem', { name: /^Save\s?Ctrl\+S$/ }))
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('saves as a .qart file from File › Save as .qart… (plan M1.5)', async () => {
    const user = userEvent.setup()
    const onSaveAs = vi.fn()
    render(<TitleBar onSaveAs={onSaveAs} />)
    await user.click(screen.getByText('File'))
    const saveAs = screen.getByRole('menuitem', { name: /^Save as \.qart\.\.\./ })
    expect(saveAs).toHaveTextContent('Ctrl+Shift+S')
    await user.click(saveAs)
    expect(onSaveAs).toHaveBeenCalledOnce()
  })

  it('opens a file from File › Open… (plan M1.5)', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<TitleBar onOpen={onOpen} />)
    await user.click(screen.getByText('File'))
    const open = screen.getByRole('menuitem', { name: /^Open\.\.\./ })
    expect(open).toHaveTextContent('Ctrl+O')
    await user.click(open)
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('renames the open project', async () => {
    const user = userEvent.setup()
    useProjectStore.setState({ currentProjectId: 'p1', currentProjectName: 'Sketch' })
    render(<TitleBar />)
    const name = screen.getByRole('textbox', { name: 'Project name' })
    await user.clear(name)
    await user.type(name, 'Harbour{Enter}')
    expect(service.renameProject).toHaveBeenCalledWith('p1', 'Harbour')
    expect(useProjectStore.getState().currentProjectName).toBe('Harbour')
  })

  it('keeps the old name when the new one is blank', async () => {
    const user = userEvent.setup()
    useProjectStore.setState({ currentProjectId: 'p1', currentProjectName: 'Sketch' })
    render(<TitleBar />)
    const name = screen.getByRole('textbox', { name: 'Project name' })
    await user.clear(name)
    await user.keyboard('{Enter}')
    expect(service.renameProject).not.toHaveBeenCalled()
    expect(name).toHaveValue('Sketch')
  })
})

