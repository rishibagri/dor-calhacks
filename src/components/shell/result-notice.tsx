import type { ReducerResult } from '@/lib/backend/ports';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export function ResultNotice({ result }: { result: ReducerResult | null }) {
  if (!result) return null;
  if (result.ok) {
    return (
      <Alert role="status"><AlertTitle>Done</AlertTitle></Alert>
    );
  }
  return (
    <Alert variant="destructive" role="alert">
      <AlertTitle>Request refused ({result.code})</AlertTitle>
      <AlertDescription>{result.message}</AlertDescription>
    </Alert>
  );
}
