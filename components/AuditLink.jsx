import Link from 'next/link';

/**
 * Deep-link to /audit with optional resource filters.
 */
export default function AuditLink({
  resourceType,
  resourceId,
  action,
  className = 'text-xs text-orange-400 underline hover:text-orange-300',
  children = 'View audit',
}) {
  const params = new URLSearchParams();
  if (resourceType) params.set('resource_type', resourceType);
  if (resourceId != null && resourceId !== '') params.set('resource_id', String(resourceId));
  if (action) params.set('action', action);
  const href = params.toString() ? `/audit?${params.toString()}` : '/audit';
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
