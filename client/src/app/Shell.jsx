import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ListVideo, Clock, CalendarDays, Hash, FolderSync,
  Copy,
  Users, Activity, HardDrive, Settings as SettingsIcon, Wand2,
  PanelLeftClose, PanelLeft, Film, Check, AlertTriangle,
} from 'lucide-react';
import { useAccount } from '../hooks/useAccount.jsx';
import './shell.css';

/**
 * Navegação agrupada por intenção, não por tipo de dado. "Publicação" reúne o
 * que sai no ar; "Conteúdo" o que alimenta a fila. O projeto anterior
 * misturava fila com editor e tinha dois itens diferentes significando a
 * mesma coisa.
 */
const NAV = [
  { items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }] },
  {
    label: 'Publicação',
    items: [
      { to: '/fila', label: 'Fila', title: 'Fila de vídeos', icon: ListVideo },
      { to: '/horarios', label: 'Horários', icon: Clock },
      { to: '/calendario', label: 'Calendário', icon: CalendarDays },
    ],
  },
  {
    label: 'Conteúdo',
    items: [
      { to: '/editor', label: 'Editor em Massa', icon: Wand2 },
      { to: '/biblioteca', label: 'Legendas & Hashtags', icon: Hash },
      { to: '/pastas', label: 'Pastas monitoradas', icon: FolderSync },
      { to: '/conteudo-repetido', label: 'Conteúdo repetido', icon: Copy },
    ],
  },
  {
    label: 'Operação',
    items: [
      { to: '/contas', label: 'Contas', icon: Users },
      { to: '/atividade', label: 'Atividade', icon: Activity },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { to: '/armazenamento', label: 'Armazenamento', icon: HardDrive },
      { to: '/configuracoes', label: 'Configurações', icon: SettingsIcon },
    ],
  },
];

/**
 * Título da barra de topo, DERIVADO do menu.
 *
 * Antes era uma segunda lista escrita à mão, e as duas saíam de sincronia na
 * primeira tela nova: o menu ganhava o item e o topo continuava mostrando
 * "Reels Manager". Um item usa `title` só quando o texto do topo precisa ser
 * mais longo que o do menu.
 */
const TITLES = Object.fromEntries(
  NAV.flatMap((g) => g.items).map((i) => [i.to, i.title ?? i.label]),
);

export default function Shell({ children }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('rm.nav') === '1');
  const { accounts, accountId, account, select } = useAccount();
  const location = useLocation();

  useEffect(() => {
    localStorage.setItem('rm.nav', collapsed ? '1' : '0');
  }, [collapsed]);

  return (
    <div className={`shell${collapsed ? ' is-collapsed' : ''}`}>
      <aside className="nav">
        <div className="nav__brand">
          <span className="nav__logo"><Film size={16} /></span>
          <span className="nav__name">
            <b>Reels Manager</b>
            <em>painel local</em>
          </span>
          <button
            className="nav__toggle"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            {collapsed ? <PanelLeft size={15} /> : <PanelLeftClose size={15} />}
          </button>
        </div>

        {!collapsed && accounts.length > 0 && (
          <div className="nav__account">
            <select value={accountId ?? ''} onChange={(e) => select(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>@{a.username}</option>
              ))}
            </select>
            <span className={`nav__dot nav__dot--${account?.connected ? 'ok' : 'off'}`} />
          </div>
        )}

        <nav className="nav__list">
          {NAV.map((group, i) => (
            <div key={i} className="nav__group">
              {group.label && !collapsed && <span className="nav__group-label">{group.label}</span>}
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav__item${isActive ? ' is-active' : ''}`}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon size={17} />
                  {!collapsed && <span>{item.label}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {!collapsed && (
          <footer className="nav__foot">
            Publicação por automação de navegador.<br />
            Nenhuma senha é armazenada.
          </footer>
        )}
      </aside>

      <div className="shell__main">
        <header className="top">
          <h1>{TITLES[location.pathname] ?? 'Reels Manager'}</h1>
          <div className="top__spacer" />
          {account && (
            <span className={`top__conn top__conn--${account.connected ? 'ok' : 'off'}`}>
              {account.connected ? <Check size={13} /> : <AlertTriangle size={13} />}
              @{account.username}
            </span>
          )}
        </header>

        <main className="page">{children}</main>
      </div>
    </div>
  );
}
