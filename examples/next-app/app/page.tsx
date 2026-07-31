'use client';
import { useState } from 'react';

export default function Home() {
  const [count, setCount] = useState(0);

  return (
    <main className="page">
      <header className="hero">
        <h1>iris</h1>
        <p className="tag">Hold Alt and click an element to start.</p>
      </header>

      <section className="card">
        <h2>Pricing</h2>
        <p>Start free. Upgrade when you ship.</p>
        <button type="button" className="cta" onClick={() => setCount((n) => n + 1)}>
          Get started{count > 0 ? ` (${count})` : ''}
        </button>
      </section>

      <section className="grid">
        <article className="feature">
          <h3>Click anything</h3>
          <p>Outline the element you want changed.</p>
        </article>
        <article className="feature">
          <h3>Queue tasks</h3>
          <p>Send prompts without leaving the tab.</p>
        </article>
        <article className="feature">
          <h3>Compare branches</h3>
          <p>Flip between agent worktrees live.</p>
        </article>
      </section>

      <footer className="footer">
        <small>made with iris</small>
      </footer>
    </main>
  );
}
