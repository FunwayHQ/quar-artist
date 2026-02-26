import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GalleryView } from './GalleryView.tsx'
import { useProjectStore } from '@stores/projectStore.ts'

describe('GalleryView', () => {
  const mockHandlers = {
    onOpenProject: vi.fn(),
    onNewProject: vi.fn(),
    onDeleteProject: vi.fn(),
    onDuplicateProject: vi.fn(),
    onRenameProject: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      projects: [
        { id: 1, name: 'My Painting', width: 1920, height: 1080, dpi: 72, createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-06-15') },
        { id: 2, name: 'Sketch', width: 2048, height: 2048, dpi: 150, createdAt: new Date('2025-03-01'), updatedAt: new Date('2025-06-10') },
      ],
    })
  })

  it('renders the gallery title', () => {
    render(<GalleryView {...mockHandlers} />)
    expect(screen.getByText('QUAR Artist')).toBeInTheDocument()
  })

  it('renders the subtitle', () => {
    render(<GalleryView {...mockHandlers} />)
    expect(screen.getByText('Your Projects')).toBeInTheDocument()
  })

  it('renders the New Project button', () => {
    render(<GalleryView {...mockHandlers} />)
    expect(screen.getByTitle('New Project')).toBeInTheDocument()
    expect(screen.getByText('New Project')).toBeInTheDocument()
  })

  it('renders project cards for each project', () => {
    render(<GalleryView {...mockHandlers} />)
    expect(screen.getByText('My Painting')).toBeInTheDocument()
    expect(screen.getByText('Sketch')).toBeInTheDocument()
  })

  it('displays project dimensions', () => {
    render(<GalleryView {...mockHandlers} />)
    expect(screen.getByText(/1920×1080/)).toBeInTheDocument()
    expect(screen.getByText(/2048×2048/)).toBeInTheDocument()
  })

  it('calls onNewProject when New Project card is clicked', async () => {
    const user = userEvent.setup()
    render(<GalleryView {...mockHandlers} />)
    await user.click(screen.getByTitle('New Project'))
    expect(mockHandlers.onNewProject).toHaveBeenCalledOnce()
  })

  it('calls onOpenProject when a project card is clicked', async () => {
    const user = userEvent.setup()
    render(<GalleryView {...mockHandlers} />)
    await user.click(screen.getByTitle('Open My Painting'))
    expect(mockHandlers.onOpenProject).toHaveBeenCalledWith(1)
  })

  it('calls onDeleteProject when delete button is clicked', async () => {
    const user = userEvent.setup()
    render(<GalleryView {...mockHandlers} />)
    const deleteButtons = screen.getAllByTitle('Delete')
    await user.click(deleteButtons[0])
    expect(mockHandlers.onDeleteProject).toHaveBeenCalledWith(1)
  })

  it('calls onDuplicateProject when duplicate button is clicked', async () => {
    const user = userEvent.setup()
    render(<GalleryView {...mockHandlers} />)
    const dupButtons = screen.getAllByTitle('Duplicate')
    await user.click(dupButtons[0])
    expect(mockHandlers.onDuplicateProject).toHaveBeenCalledWith(1)
  })

  it('renders empty state with only new project button', () => {
    useProjectStore.setState({ projects: [] })
    render(<GalleryView {...mockHandlers} />)
    expect(screen.getByText('New Project')).toBeInTheDocument()
    expect(screen.queryByText('My Painting')).not.toBeInTheDocument()
  })
})
