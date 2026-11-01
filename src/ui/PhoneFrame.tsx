import type { ReactNode } from 'react';

/** Native: the device is the frame. See PhoneFrame.web.tsx. */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
