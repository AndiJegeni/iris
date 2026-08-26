# @andijegeni/iris

The drop-in React component for [Iris](https://github.com/AndiJegeni/iris) —
agents that live in your tab.

In development it injects the Iris overlay into your page; in production it
renders nothing.

```bash
npm i -D @andijegeni/iris
```

```tsx
// app/layout.tsx (or your root component)
import { Iris } from '@andijegeni/iris';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Iris />
      </body>
    </html>
  );
}
```

In a Next.js root layout `<Iris />` must go **inside `<body>`** — anything
between `</body>` and `</html>` is invalid markup React won't render.

The overlay only appears when the Iris daemon is running. Start it with
`npx useiris`. If you moved the daemon off port 4747, tell the component too:

```tsx
<Iris daemonUrl="http://localhost:4748" />
```

Full docs: **https://github.com/AndiJegeni/iris**

MIT © Andi Jegeni.
