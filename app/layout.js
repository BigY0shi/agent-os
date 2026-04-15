import './globals.css';
import Sidebar from '@/components/Sidebar';

export const metadata = {
  title: 'YOSHI — Agent OS',
  description: 'Harness-agnostic agentic command center. Manage agents, skills, tools, and workflows.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="dark">
      <body className="bg-surface-950">
        {/* Sidebar (fixed on lg+, bottom-nav on mobile) */}
        <Sidebar />

        {/* Main Content — no flex, just margin-offset for the fixed sidebar */}
        <main className="ml-0 lg:ml-[220px] min-h-screen pb-14 lg:pb-0 overflow-x-clip">
          <div className="p-4 lg:p-6 max-w-[1400px] mx-auto">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
