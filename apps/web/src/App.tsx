import { Shell, useRoute } from './components/Shell';
import { AdminLeads } from './features/admin/AdminLeads';
import { ApplicationFlow } from './features/application/ApplicationFlow';
import { AssistantPanel } from './features/assistant/AssistantPanel';

export default function App() {
  const route = useRoute();
  return (
    <Shell route={route}>
      <div key={route} className="page">
      {route === 'apply' && <ApplicationFlow />}
      {route === 'assistant' && (
        <>
          <div className="intro"><h1>Ask the loan assistant.</h1><p>Prefer to talk it through? The assistant uses the same quotation and submission services as the form.</p></div>
          <AssistantPanel />
        </>
      )}
      {route === 'admin' && <AdminLeads />}
      </div>
    </Shell>
  );
}
