import { AuthProvider } from './context/AuthContext';
import { PortalRouter } from './components/PortalRouter';

function App() {
  return (
    <AuthProvider>
      <PortalRouter />
    </AuthProvider>
  );
}

export default App;
