import { Routes, Route, Navigate } from 'react-router-dom';
import { AccountProvider } from '../hooks/useAccount.jsx';
import { ToastProvider } from '../hooks/useToast.jsx';
import { ConfirmProvider } from '../hooks/useConfirm.jsx';
import Shell from './Shell.jsx';

import Dashboard from '../features/dashboard/Dashboard.jsx';
import Queue from '../features/queue/Queue.jsx';
import Schedule from '../features/schedule/Schedule.jsx';
import Calendar from '../features/calendar/Calendar.jsx';
import Library from '../features/library/Library.jsx';
import Editor from '../features/editor/Editor.jsx';
import Folders from '../features/folders/Folders.jsx';
import Duplicates from '../features/duplicates/Duplicates.jsx';
import Accounts from '../features/accounts/Accounts.jsx';
import Activity from '../features/activity/Activity.jsx';
import Storage from '../features/storage/Storage.jsx';
import Settings from '../features/settings/Settings.jsx';

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AccountProvider>
          <Shell>
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
              <Route path="/configuracoes" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Shell>
        </AccountProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
