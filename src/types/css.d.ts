// Tells TypeScript to allow CSS side-effect imports like `import './globals.css'`
declare module '*.css' {
  const content: Record<string, string>
  export default content
}