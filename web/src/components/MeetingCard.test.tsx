import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MeetingCard } from './MeetingCard';

describe('MeetingCard', () => {
  it('shows a skeleton while data is null', () => {
    render(<MeetingCard title="Summary" data={null}>{(d: string[]) => <p>{d.join()}</p>}</MeetingCard>);
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
    expect(screen.getByText('Summary')).toBeInTheDocument();
  });

  it('renders content once data arrives', () => {
    render(<MeetingCard title="Summary" data={['a', 'b']}>{(d) => <p>{d.join('+')}</p>}</MeetingCard>);
    expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
    expect(screen.getByText('a+b')).toBeInTheDocument();
  });

  it('shows the error instead of skeleton or content', () => {
    render(<MeetingCard title="Summary" data={null} error="boom">{(d: string[]) => <p>{d.join()}</p>}</MeetingCard>);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
    expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
  });
});
