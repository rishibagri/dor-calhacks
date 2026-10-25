import type { Metadata } from 'next';
import { Backstage } from '@/components/backstage/backstage';

export const metadata: Metadata = { title: 'dor · backstage', robots: { index: false, follow: false } };

/** D053 demo backstage: what dor's backend and agents are doing between users. Observer-gated by the module. */
export default function BackstagePage() {
  return <Backstage />;
}
