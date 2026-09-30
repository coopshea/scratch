/** Where to connect Readwise: the account page when hosted, the .env file locally. Null while unknown or connected. */
export type ReadwiseOff = { href: string; where: string } | null;

/**
 * A Readwise control while Readwise isn't connected: greyed, and on hover it says why and links to where to connect.
 * Clicking it goes there too.
 */
export function NeedsReadwise({ off, children }: { off: NonNullable<ReadwiseOff>; children: React.ReactNode }) {
  const external = off.href.startsWith('http');
  return (
    <span className="needs-readwise">
      <a className="needs-readwise-control" href={off.href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})} aria-disabled>
        {children}
      </a>
      <span className="needs-readwise-tip" role="tooltip">
        Readwise isn't connected. <a href={off.href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>{off.where}</a>
      </span>
    </span>
  );
}
