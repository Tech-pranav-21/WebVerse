/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { SnapshotItem } from '../types/camera';
import { useObjectUrl } from '../hooks/useObjectUrl';

/** <img> for a stored snapshot; its blob: URL is created on mount and revoked on unmount. */
export const SnapshotImage: React.FC<{
  item: SnapshotItem;
  alt: string;
  className?: string;
}> = ({ item, alt, className }) => {
  const url = useObjectUrl(item.blob);
  if (!url) return <div className={`${className ?? ''} bg-black/40`} aria-hidden="true" />;
  return <img src={url} alt={alt} className={className} decoding="async" />;
};
