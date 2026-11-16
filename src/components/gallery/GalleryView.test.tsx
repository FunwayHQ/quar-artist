import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GalleryView, type GalleryActions } from './GalleryView.tsx'
import { useProjectStore } from '@stores/projectStore.ts'
import type { ProjectRecord, StackRecord } from '../../db/schema.ts'

function project(id: string, name: string, extra: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id,
    name,
    width: 1920,
    height: 1080,
    dpi: 72,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-06-01'),
    ...extra,
  }
}

function stack(id: string, name: string): StackRecord {
  return { id, name, createdAt: new Date('2025-02-01'), updatedAt: new Date('2025-02-01') }
}

function mockActions() {
  return {
    openProject: vi.fn<GalleryActions['openProject']>(),
    newProject: vi.fn<GalleryActions['newProject']>(),
    renameProject: vi.fn<GalleryActions['renameProject']>(),
    duplicateProject: vi.fn<GalleryActions['duplicateProject']>(),
    deleteProject: vi.fn<GalleryActions['deleteProject']>(),
    moveToStack: vi.fn<GalleryActions['moveToStack']>(),
    createStack: vi.fn<GalleryActions['createStack']>(),
    renameStack: vi.fn<GalleryActions['renameStack']>(),
    unstack: vi.fn<GalleryActions['unstack']>(),
    openStack: vi.fn<GalleryActions['openStack']>(),
    setSort: vi.fn<GalleryActions['setSort']>(),
    importFiles: vi.fn<GalleryActions['importFiles']>(),
  } satisfies GalleryActions
}

/** Card names in the order the grid shows them. */
function cardNames(): string[] {
  return screen.getAllByRole('article').map((a) => a.getAttribute('aria-label') ?? '')
}

async function openCardMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }))
  return screen.getByRole('menu')
}

describe('GalleryView', () => {
  let actions: ReturnType<typeof mockActions>

  beforeEach(() => {
    actions = mockActions()
    useProjectStore.setState({
      projects: [
        project('p1', 'My Painting', { updatedAt: new Date('2025-06-15'), createdAt: new Date('2025-01-01') }),
        project('p2', 'Sketch', { width: 2048, height: 2048, updatedAt: new Date('2025-06-10'), createdAt: new Date('2025-03-01') }),
      ],
      stacks: [],
      gallerySort: 'updated',
      openStackId: null,
      lastProjectId: null,
    })
  })

  it('shows the logo as the gallery title', () => {
    render(<GalleryView actions={actions} />)
    const logo = screen.getByAltText('QUAR Artist')
    expect(logo).toHaveAttribute('src', '/logo.svg')
    expect(logo.closest('h1')).not.toBeNull()
  })

  it('renders the subtitle', () => {
    render(<GalleryView actions={actions} />)
    expect(screen.getByText('Your Projects')).toBeInTheDocument()
  })

  it('renders a card for each project, with its size', () => {
    render(<GalleryView actions={actions} />)
    expect(cardNames()).toEqual(['My Painting', 'Sketch'])
    expect(screen.getByText(/1920×1080/)).toBeInTheDocument()
    expect(screen.getByText(/2048×2048/)).toBeInTheDocument()
  })

  it('asks for a new project from the New Project card', async () => {
    const user = userEvent.setup({ delay: null })
    render(<GalleryView actions={actions} />)
    await user.click(screen.getByRole('button', { name: /New Project/ }))
    expect(actions.newProject).toHaveBeenCalledOnce()
  })

  it('opens a project from its card', async () => {
    const user = userEvent.setup({ delay: null })
    render(<GalleryView actions={actions} />)
    await user.click(screen.getByRole('button', { name: 'Open My Painting' }))
    expect(actions.openProject).toHaveBeenCalledWith('p1')
  })

  it('shows only the New Project card when there are no projects', () => {
    useProjectStore.setState({ projects: [] })
    render(<GalleryView actions={actions} />)
    expect(screen.queryAllByRole('article')).toHaveLength(0)
    expect(screen.getByRole('button', { name: /New Project/ })).toBeInTheDocument()
  })

  describe('Continue', () => {
    it('offers to continue the last project', async () => {
      const user = userEvent.setup({ delay: null })
      useProjectStore.setState({ lastProjectId: 'p2' })
      render(<GalleryView actions={actions} />)
      await user.click(screen.getByRole('button', { name: 'Continue Sketch' }))
      expect(actions.openProject).toHaveBeenCalledWith('p2')
    })

    it('is not offered when the last project is gone', () => {
      useProjectStore.setState({ lastProjectId: 'deleted' })
      render(<GalleryView actions={actions} />)
      expect(screen.queryByRole('button', { name: /^Continue/ })).toBeNull()
    })
  })

  describe('sorting', () => {
    beforeEach(() => {
      useProjectStore.setState({
        projects: [
          project('a', 'banana', { createdAt: new Date('2025-01-03'), updatedAt: new Date('2025-01-04') }),
          project('b', 'Apple 10', { createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-01-09') }),
          project('c', 'Apple 9', { createdAt: new Date('2025-01-05'), updatedAt: new Date('2025-01-02') }),
        ],
      })
    })

    it('shows the most recently modified first by default', () => {
      render(<GalleryView actions={actions} />)
      expect(cardNames()).toEqual(['Apple 10', 'banana', 'Apple 9'])
    })

    it('sorts by date created', () => {
      useProjectStore.setState({ gallerySort: 'created' })
      render(<GalleryView actions={actions} />)
      expect(cardNames()).toEqual(['Apple 9', 'banana', 'Apple 10'])
    })

    it('sorts by name, ignoring case and reading numbers as numbers', () => {
      useProjectStore.setState({ gallerySort: 'name' })
      render(<GalleryView actions={actions} />)
      expect(cardNames()).toEqual(['Apple 9', 'Apple 10', 'banana'])
    })

    it('asks for another sort from the menu', () => {
      render(<GalleryView actions={actions} />)
      fireEvent.change(screen.getByLabelText('Sort projects'), { target: { value: 'name' } })
      expect(actions.setSort).toHaveBeenCalledWith('name')
    })
  })

  describe('project actions', () => {
    it('duplicates from the card menu', async () => {
      const user = userEvent.setup({ delay: null })
      render(<GalleryView actions={actions} />)
      const menu = await openCardMenu(user, 'Sketch')
      await user.click(within(menu).getByRole('menuitem', { name: 'Duplicate' }))
      expect(actions.duplicateProject).toHaveBeenCalledWith('p2')
    })

    it('deletes from the card menu', async () => {
      const user = userEvent.setup({ delay: null })
      render(<GalleryView actions={actions} />)
      const menu = await openCardMenu(user, 'My Painting')
      await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }))
      expect(actions.deleteProject).toHaveBeenCalledWith('p1')
    })

    it('opens the same menu on right-click', () => {
      render(<GalleryView actions={actions} />)
      fireEvent.contextMenu(screen.getByRole('article', { name: 'Sketch' }))
      expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
    })

    it('renames inline from the menu, keeping the name on Enter', async () => {
      const user = userEvent.setup({ delay: null })
      render(<GalleryView actions={actions} />)
      const menu = await openCardMenu(user, 'Sketch')
      await user.click(within(menu).getByRole('menuitem', { name: 'Rename' }))

      const input = screen.getByRole('textbox', { name: 'Project name' })
      expect(input).toHaveFocus()
      await user.clear(input)
      await user.type(input, 'Final Sketch{Enter}')
      expect(actions.renameProject).toHaveBeenCalledWith('p2', 'Final Sketch')
      expect(screen.queryByRole('textbox', { name: 'Project name' })).toBeNull()
    })

    it('renames on double-click, and Escape keeps the old name', async () => {
      const user = userEvent.setup({ delay: null })
      render(<GalleryView actions={actions} />)
      await user.dblClick(screen.getByText('Sketch'))
      const input = screen.getByRole('textbox', { name: 'Project name' })
      await user.type(input, ' changed{Escape}')
      expect(actions.renameProject).not.toHaveBeenCalled()
      expect(screen.getByText('Sketch')).toBeInTheDocument()
    })

    it('ignores a blank or unchanged name', async () => {
      const user = userEvent.setup({ delay: null })
      render(<GalleryView actions={actions} />)
      await user.dblClick(screen.getByText('Sketch'))
      await user.clear(screen.getByRole('textbox', { name: 'Project name' }))
      await user.keyboard('{Enter}')
      await user.dblClick(screen.getByText('Sketch'))
      await user.keyboard('{Enter}')
      expect(actions.renameProject).not.toHaveBeenCalled()
    })
  })

  describe('stacks', () => {
    beforeEach(() => {
      useProjectStore.setState({
        projects: [
          project('p1', 'My Painting', { updatedAt: new Date('2025-06-15') }),
          project('p2', 'Sketch', { stackId: 's1', updatedAt: new Date('2025-06-10') }),
          project('p3', 'Study', { stackId: 's1', updatedAt: new Date('2025-06-20') }),
          project('p4', 'Lost', { stackId: 'gone', updatedAt: new Date('2025-06-01') }),
        ],
        stacks: [stack('s1', 'Studies'), stack('s2', 'Empty')],
      })
    })

    it('shows stacks before projects, with their size, and hides empty ones', () => {
      render(<GalleryView actions={actions} />)
      // A project whose stack no longer exists shows at the top level.
      expect(cardNames()).toEqual(['Stack Studies', 'My Painting', 'Lost'])
      expect(screen.getByText('2 projects')).toBeInTheDocument()
    })

    it('opens a stack', async () => {
      const user = userEvent.setup({ delay: null })
      render(<GalleryView actions={actions} />)
      await user.click(screen.getByRole('button', { name: 'Open stack Studies' }))
      expect(actions.openStack).toHaveBeenCalledWith('s1')
    })

    it('shows an open stack\'s projects, with a way back', async () => {
      const user = userEvent.setup({ delay: null })
      useProjectStore.setState({ openStackId: 's1', lastProjectId: 'p1' })
      render(<GalleryView actions={actions} />)

      expect(cardNames()).toEqual(['Study', 'Sketch'])
      expect(screen.getByRole('navigation', { name: 'Gallery location' })).toHaveTextContent('Studies')
      expect(screen.queryByRole('button', { name: /^Continue/ })).toBeNull()

      await user.click(screen.getByRole('button', { name: 'Gallery' }))
      expect(actions.openStack).toHaveBeenCalledWith(null)
    })

    it('removes a project from the open stack', async () => {
      const user = userEvent.setup({ delay: null })
      useProjectStore.setState({ openStackId: 's1' })
      render(<GalleryView actions={actions} />)
      const menu = await openCardMenu(user, 'Sketch')
      await user.click(within(menu).getByRole('menuitem', { name: 'Remove from Stack' }))
      expect(actions.moveToStack).toHaveBeenCalledWith('p2', null)
    })

    it('offers Remove from Stack only inside a stack', async () => {
      const user = userEvent.setup({ delay: null })
      render(<GalleryView actions={actions} />)
      const menu = await openCardMenu(user, 'My Painting')
      expect(within(menu).queryByRole('menuitem', { name: 'Remove from Stack' })).toBeNull()
    })

    it('moves a project into an existing stack', async () => {
      const user = userEvent.setup({ delay: null })
      render(<GalleryView actions={actions} />)
      const menu = await openCardMenu(user, 'My Painting')
      await user.click(within(menu).getByRole('menuitem', { name: 'Move to Stack…' }))

      const dialog = screen.getByRole('dialog', { name: 'Move to Stack' })
      await user.click(within(dialog).getByRole('button', { name: 'Studies' }))
      expect(actions.moveToStack).toHaveBeenCalledWith('p1', 's1')
      expect(screen.queryByRole('dialog', { name: 'Move to Stack' })).toBeNull()
    })

    it('moves a project into a new stack', async () => {
      const user = userEvent.setup({ delay: null })
      render(<GalleryView actions={actions} />)
      const menu = await openCardMenu(user, 'My Painting')
      await user.click(within(menu).getByRole('menuitem', { name: 'Move to Stack…' }))

      const dialog = screen.getByRole('dialog', { name: 'Move to Stack' })
      expect(within(dialog).getByRole('button', { name: 'New Stack' })).toBeDisabled()
      await user.type(within(dialog).getByRole('textbox', { name: 'New stack name' }), 'Portraits{Enter}')
      expect(actions.createStack).toHaveBeenCalledWith('Portraits', ['p1'])
    })

    it('offers the top level to a stacked project, and not its own stack', async () => {
      const user = userEvent.setup({ delay: null })
      useProjectStore.setState({ openStackId: 's1' })
      render(<GalleryView actions={actions} />)
      const menu = await openCardMenu(user, 'Sketch')
      await user.click(within(menu).getByRole('menuitem', { name: 'Move to Stack…' }))

      const dialog = screen.getByRole('dialog', { name: 'Move to Stack' })
      expect(within(dialog).queryByRole('button', { name: 'Studies' })).toBeNull()
      await user.click(within(dialog).getByRole('button', { name: 'Top level (no stack)' }))
      expect(actions.moveToStack).toHaveBeenCalledWith('p2', null)
    })

    it('closes the stack dialog on Escape', async () => {
      const user = userEvent.setup({ delay: null })
      render(<GalleryView actions={actions} />)
      const menu = await openCardMenu(user, 'My Painting')
      await user.click(within(menu).getByRole('menuitem', { name: 'Move to Stack…' }))
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog', { name: 'Move to Stack' })).toBeNull()
      expect(actions.moveToStack).not.toHaveBeenCalled()
    })

    it('renames a stack from its menu', async () => {
      const user = userEvent.setup({ delay: null })
      render(<GalleryView actions={actions} />)
      const menu = await openCardMenu(user, 'stack Studies')
      await user.click(within(menu).getByRole('menuitem', { name: 'Rename' }))
      const input = screen.getByRole('textbox', { name: 'Stack name' })
      await user.clear(input)
      await user.type(input, 'Old{Enter}')
      expect(actions.renameStack).toHaveBeenCalledWith('s1', 'Old')
    })

    it('unstacks a stack from its menu', async () => {
      const user = userEvent.setup({ delay: null })
      render(<GalleryView actions={actions} />)
      const menu = await openCardMenu(user, 'stack Studies')
      await user.click(within(menu).getByRole('menuitem', { name: 'Unstack' }))
      expect(actions.unstack).toHaveBeenCalledWith('s1')
    })
  })

  describe('import', () => {
    const png = () => new File([new Uint8Array([1])], 'cat.png', { type: 'image/png' })

    it('imports dropped files', () => {
      render(<GalleryView actions={actions} />)
      const gallery = screen.getByText('Your Projects').closest('div')!
      const file = png()
      const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' }

      fireEvent.dragOver(gallery, { dataTransfer })
      expect(screen.getByText(/Drop .qart files or images/)).toBeInTheDocument()
      fireEvent.drop(gallery, { dataTransfer })

      expect(actions.importFiles).toHaveBeenCalledWith([file])
      expect(screen.queryByText(/Drop .qart files or images/)).toBeNull()
    })

    it('ignores drags that carry no files', () => {
      render(<GalleryView actions={actions} />)
      const gallery = screen.getByText('Your Projects').closest('div')!
      fireEvent.dragOver(gallery, { dataTransfer: { types: ['text/plain'], files: [] } })
      expect(screen.queryByText(/Drop .qart files or images/)).toBeNull()
    })

    it('imports files picked with the Import button', async () => {
      const user = userEvent.setup({ delay: null })
      render(<GalleryView actions={actions} />)
      const file = png()
      await user.upload(screen.getByLabelText('Import files'), file)
      expect(actions.importFiles).toHaveBeenCalledWith([file])
    })
  })

  it('shows a saved thumbnail through an object URL, and frees it', () => {
    const createObjectURL = vi.fn(() => 'blob:thumb')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    const thumb = { type: 'image/webp', data: new Uint8Array([1, 2, 3]).buffer }
    useProjectStore.setState({ projects: [project('p1', 'My Painting', { thumbnail: thumb })] })

    const { unmount } = render(<GalleryView actions={actions} />)
    const img = screen.getByRole('button', { name: 'Open My Painting' }).querySelector('img')!
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    const blob = (createObjectURL.mock.calls[0] as unknown[])[0] as Blob
    expect(blob.type).toBe('image/webp')
    expect(blob.size).toBe(3)
    expect(img).toHaveAttribute('src', 'blob:thumb')

    unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:thumb')
    vi.unstubAllGlobals()
  })
})
