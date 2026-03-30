/**
 * BtnSpinner — tiny inline spinner for inside buttons
 * Replaces or appends to button label while pending
 */
export function BtnSpinner({ size = 14 }) {
  return (
    <span style={{
      display: 'inline-block',
      width:  size,
      height: size,
      border: `${Math.max(2, size * 0.14)}px solid rgba(255,255,255,0.25)`,
      borderTopColor: 'rgba(255,255,255,0.9)',
      borderRadius: '50%',
      animation: 'btn-spin 0.65s linear infinite',
      flexShrink: 0,
      verticalAlign: 'middle',
    }} />
  )
}
