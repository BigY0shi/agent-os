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
        <div className="flex flex-row h-screen lg:h-auto">
          {/* Sidebar */}
          <Sidebar />

          {/* Main Content */}
          <main className="flex-1 ml-0 lg:ml-[220px] min-h-screen pb-14 lg:pb-0">
            <div className="p-4 lg:p-6 max-w-[1400px] mx-auto">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
