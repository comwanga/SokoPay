import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout.tsx'
import Dashboard from './components/Dashboard.tsx'
import Farmers from './components/Farmers.tsx'
import Payments from './components/Payments.tsx'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/farmers" element={<Farmers />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
