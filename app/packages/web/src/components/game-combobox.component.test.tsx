import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameCombobox } from './game-combobox.component.js';

const GAMES = ['minecraft', 'valheim', 'palworld'];

describe('GameCombobox', () => {
  it('should render the selected value on the trigger button', () => {
    render(<GameCombobox games={GAMES} value="minecraft" onChange={() => undefined} />);

    expect(screen.getByRole('button', { name: /Game selector, minecraft selected/ })).toHaveTextContent(
      'minecraft',
    );
  });

  it('should render the placeholder when no value is selected', () => {
    render(<GameCombobox games={GAMES} value="" onChange={() => undefined} />);

    const trigger = screen.getByRole('button', { name: 'Game selector' });
    expect(trigger).toHaveTextContent('Select a game…');
  });

  it('should mark the trigger as collapsed by default', () => {
    render(<GameCombobox games={GAMES} value="minecraft" onChange={() => undefined} />);

    expect(screen.getByRole('button', { name: /Game selector/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('should open the popover and reveal every game when the trigger is clicked', async () => {
    const user = userEvent.setup();
    render(<GameCombobox games={GAMES} value="minecraft" onChange={() => undefined} />);

    await user.click(screen.getByRole('button', { name: /Game selector/ }));

    expect(screen.getByRole('button', { name: /Game selector/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByPlaceholderText('Search games…')).toBeInTheDocument();
    for (const g of GAMES) {
      expect(screen.getByRole('button', { name: g })).toBeInTheDocument();
    }
  });

  it('should filter the games list by the search query', async () => {
    const user = userEvent.setup();
    render(<GameCombobox games={GAMES} value="minecraft" onChange={() => undefined} />);
    await user.click(screen.getByRole('button', { name: /Game selector/ }));

    await user.type(screen.getByPlaceholderText('Search games…'), 'val');

    expect(screen.getByRole('button', { name: 'valheim' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'minecraft' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'palworld' })).toBeNull();
  });

  it('should show the empty-state message when the search matches no games', async () => {
    const user = userEvent.setup();
    render(<GameCombobox games={GAMES} value="minecraft" onChange={() => undefined} />);
    await user.click(screen.getByRole('button', { name: /Game selector/ }));

    await user.type(screen.getByPlaceholderText('Search games…'), 'zzz');

    expect(screen.getByText('No games found.')).toBeInTheDocument();
  });

  it('should fire onChange and close the popover when a game is picked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<GameCombobox games={GAMES} value="minecraft" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /Game selector/ }));

    await user.click(screen.getByRole('button', { name: 'valheim' }));

    expect(onChange).toHaveBeenCalledWith('valheim');
    expect(onChange).toHaveBeenCalledTimes(1);
    // Popover collapsed → search input no longer rendered.
    expect(screen.queryByPlaceholderText('Search games…')).toBeNull();
  });

  it('should close the popover when Escape is pressed', async () => {
    const user = userEvent.setup();
    render(<GameCombobox games={GAMES} value="minecraft" onChange={() => undefined} />);
    await user.click(screen.getByRole('button', { name: /Game selector/ }));
    expect(screen.getByPlaceholderText('Search games…')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByPlaceholderText('Search games…')).toBeNull();
  });
});
