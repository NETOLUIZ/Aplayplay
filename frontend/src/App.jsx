import './App.css'
import { Navigate, Route, Routes } from 'react-router-dom'
import AdminTraderPage from './pages/AdminTraderPage'
import AppLayout from './components/AppLayout'
import BookingRequestDemoPage from './pages/BookingRequestDemoPage'
import DriverDashboardDemoPage from './pages/DriverDashboardDemoPage'
import DriverSignupPage from './pages/DriverSignupPage'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import PassengerAddDriverPage from './pages/PassengerAddDriverPage'
import PassengerDriversPage from './pages/PassengerDriversPage'
import PassengerInviteEntryPage from './pages/PassengerInviteEntryPage'
import PassengerLoginPage from './pages/PassengerLoginPage'
import PassengerRegisterPage from './pages/PassengerRegisterPage'

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/home" element={<LandingPage />} />
        <Route path="/passageiro" element={<Navigate to="/passageiro/motoristas" replace />} />
        <Route path="/passageiro/solicitar" element={<BookingRequestDemoPage />} />
        <Route path="/passageiro/solicitar/:motoristaId" element={<BookingRequestDemoPage />} />
        <Route path="/passageiro/motoristas" element={<PassengerDriversPage />} />
        <Route path="/passageiro/add-motorista" element={<PassengerAddDriverPage />} />
        <Route path="/motorista" element={<Navigate to="/motorista/login" replace />} />
        <Route path="/motorista/login" element={<LoginPage />} />
        <Route path="/motorista/cadastro" element={<DriverSignupPage />} />
        <Route path="/motorista/dashboard" element={<DriverDashboardDemoPage requireRegistration />} />
        <Route path="/admin" element={<Navigate to="/admin/trader" replace />} />
        <Route path="/m/:motoristaId" element={<PassengerInviteEntryPage />} />
        <Route path="/register" element={<PassengerRegisterPage />} />

        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<PassengerLoginPage />} />
        <Route path="/login/motorista" element={<LoginPage />} />
        <Route path="/cadastro/motorista" element={<DriverSignupPage />} />
        <Route path="/solicitar/:slug" element={<BookingRequestDemoPage />} />
        <Route path="/demo/cliente-solicitar" element={<BookingRequestDemoPage />} />
        <Route path="/demo/dashboard-motorista" element={<DriverDashboardDemoPage />} />
        <Route path="/app/motorista/dashboard" element={<DriverDashboardDemoPage requireRegistration />} />
        <Route path="/admin/trader" element={<AdminTraderPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default App
