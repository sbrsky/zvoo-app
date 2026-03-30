import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import PlayerCard from '../../components/PlayerCard.jsx'

describe('PlayerCard', () => {
  const mockPlayer = {
    username: 'TestPlayer',
    avatar_url: null,
    role: 'listener',
  }

  it('renders player name', () => {
    render(<PlayerCard player={mockPlayer} />)
    expect(screen.getByText('TestPlayer')).toBeInTheDocument()
  })

  it('renders role badge', () => {
    render(<PlayerCard player={mockPlayer} />)
    // Component displays Russian label "Гость" for roles
    expect(screen.getByText(/Гость/)).toBeInTheDocument()
  })

  it('shows "ВЫ" badge when isCurrentUser is true', () => {
    render(<PlayerCard player={mockPlayer} isCurrentUser={true} />)
    expect(screen.getByText('ВЫ')).toBeInTheDocument()
  })

  it('does not show "ВЫ" badge when isCurrentUser is false', () => {
    render(<PlayerCard player={mockPlayer} isCurrentUser={false} />)
    expect(screen.queryByText('ВЫ')).not.toBeInTheDocument()
  })

  it('renders empty slot when no player', () => {
    render(<PlayerCard player={null} />)
    expect(screen.getByText(/ожидание/i)).toBeInTheDocument()
  })
})
