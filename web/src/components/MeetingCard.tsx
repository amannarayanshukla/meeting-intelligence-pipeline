import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface Props<T> {
  title: string;
  data: T | null;
  error?: string;
  children: (data: T) => ReactNode;
}

export function MeetingCard<T>({ title, data, error, children }: Props<T>) {
  return (
    <Card className="min-h-48">
      <CardHeader>
        <CardTitle className="text-sm font-medium tracking-wide uppercase text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <p role="alert" className="text-sm text-destructive">{error}</p>
        ) : data === null ? (
          <div data-testid="skeleton" className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          children(data)
        )}
      </CardContent>
    </Card>
  );
}
