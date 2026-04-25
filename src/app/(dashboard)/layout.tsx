/**
 * (dashboard) route group layout — minimal passthrough.
 *
 * This layout only exists because the route group (dashboard) claims the root "/"
 * URL segment via its page.tsx, which immediately redirects to /login.
 * No sidebar or portal context is needed here — the redirect fires before
 * any layout content is rendered.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}