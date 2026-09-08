import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AccountProvider } from '../hooks/useAccount.jsx';
import { ToastProvider } from '../hooks/useToast.jsx';
import { ConfirmProvider } from '../hooks/useConfirm.jsx';
import { Skeleton } from '../design/ui.jsx';
import Shell from './Shell.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

/**
 * Telas carregadas sob demanda.
 *
 * Antes todas vinham no mesmo arquivo: abrir o Dashboard baixava junto o
 * editor de template inteiro, o calendário e o resto — 285 KB antes de
 * desenhar o primeiro pixel. Agora cada rota é um pedaço próprio, que só chega
 * quando alguém abre aquela tela.
 *
 * O Dashboard fica ESTÁTICO de propósito: é a primeira tela que abre, e adiar
 * o que já vai ser usado só acrescentaria um piscar de esqueleto.
 */
import Dashboard from '../features/dashboard/Dashboard.jsx';

const Queue = lazy(() => import('../features/queue/Queue.jsx'));
const Schedule = lazy(() => import('../features/schedule/Schedule.jsx'));
const Calendar = lazy(() => import('../features/calendar/Calendar.jsx'));
const Library = lazy(() => import('../features/library/Library.jsx'));
const Editor = lazy(() => import('../features/editor/Editor.jsx'));
const Folders = lazy(() => import('../features/folders/Folders.jsx'));
const Duplicates = lazy(() => import('../features/duplicates/Duplicates.jsx'));
const Accounts = lazy(() => import('../features/accounts/Accounts.jsx'));
const Activity = lazy(() => import('../features/activity/Activity.jsx'));
const Storage = lazy(() => import('../features/storage/Storage.jsx'));
const Settings = lazy(() => import('../features/settings/Settings.jsx'));
const Assistant = lazy(() => import('../features/assistant/Assistant.jsx'));
const WhatsApp = lazy(() => import('../features/whatsapp/WhatsApp.jsx'));

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AccountProvider>
          <Shell>
            {/* A fronteira vem POR FORA do Suspense: o erro que interessa é o
                do pedaço que não chegou, e ele estoura enquanto o Suspense
                ainda espera. Por dentro, nunca seria alcançada. */}
            <ErrorBoundary>
              {/* O mesmo esqueleto que as telas usam enquanto buscam dados: a
                  troca de rota fica indistinguível de um carregamento normal. */}
              <Suspense fallback={<Skeleton height={360} />}>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/fila" element={<Queue />} />
                  <Route path="/horarios" element={<Schedule />} />
                  <Route path="/calendario" element={<Calendar />} />
                  <Route path="/editor" element={<Editor />} />
                  <Route path="/biblioteca" element={<Library />} />
                  <Route path="/pastas" element={<Folders />} />
                  <Route path="/conteudo-repetido" element={<Duplicates />} />
                  <Route path="/contas" element={<Accounts />} />
                  <Route path="/atividade" element={<Activity />} />
                  <Route path="/armazenamento" element={<Storage />} />
                  <Route path="/whatsapp" element={<WhatsApp />} />
                  <Route path="/assistente" element={<Assistant />} />
                  <Route path="/configuracoes" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </Shell>
        </AccountProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
