export const features = [
  {
    icon: '👥',
    title: 'Gestao de Clientes',
    text: 'Mantenha um historico detalhado de passageiros, preferencias e recorrencia para atendimento premium.',
  },
  {
    icon: '📅',
    title: 'Agendamento Facil',
    text: 'Receba corridas por horario com um link de agendamento e reduza mensagens manuais no WhatsApp.',
  },
  {
    icon: '📈',
    title: 'Relatorios Financeiros',
    text: 'Visualize ganhos, custos e lucro por periodo com indicadores claros e objetivos.',
  },
  {
    icon: '🧾',
    title: 'Recibos Profissionais',
    text: 'Gere recibos e comprovantes com poucos cliques para enviar aos clientes no fim da corrida.',
  },
  {
    icon: '🗺️',
    title: 'Rotas e Deslocamento',
    text: 'Organize pontos de embarque e desembarque com foco em produtividade e menos tempo ocioso.',
  },
  {
    icon: '📱',
    title: 'Web App no Celular',
    text: 'Use no navegador do telefone com visual otimizado para operacao diaria na rua.',
  },
]

export const marketingStats = [
  ['5k+', 'Motoristas Ativos'],
  ['120k', 'Corridas/Mes'],
  ['R$ 2 mi', 'Gerados para Motoristas'],
  ['4.9', 'Avaliacao Media'],
]

export const requestSteps = [
  {
    kind: 'pickup',
    eta: 'EMBARQUE • 4 min',
    title: 'Shopping Patio Paulista',
    address: 'R. Treze de Maio, 1947 - Bela Vista',
  },
  {
    kind: 'dropoff',
    eta: 'DESTINO • 18 min',
    title: 'Parque Ibirapuera',
    address: 'Av. Pedro Alvares Cabral - Vila Mariana',
  },
]

export const dashboardMenu = [
  { icon: '📊', label: 'Dashboard', active: true },
  { icon: '🚗', label: 'Corridas' },
  { icon: '💳', label: 'Ganhos' },
  { icon: '🚌', label: 'Link' },
  { icon: '⭐', label: 'Avaliacoes' },
  { icon: '💱', label: 'Tarifas' },
]

export const initialDashboardStats = [
  {
    key: 'earnings',
    icon: '💸',
    iconClass: 'driver-stat__icon driver-stat__icon--money',
    label: 'Ganhos do Dia',
    value: 'R$ 250,00',
    badge: '+15%',
    hint: 'vs. ontem',
  },
  {
    key: 'rides',
    icon: '🚘',
    iconClass: 'driver-stat__icon driver-stat__icon--rides',
    label: 'Corridas Realizadas',
    value: '12',
    badge: '+2',
    hint: 'vs. media diaria',
  },
  {
    key: 'rating',
    icon: '⭐',
    iconClass: 'driver-stat__icon driver-stat__icon--rating',
    label: 'Avaliacao Media',
    value: '4.95',
    badge: 'Excelente',
    hint: 'Top 5% motoristas',
  },
]

export const initialUpcomingRides = [
  {
    id: 1,
    initials: 'MA',
    passenger: 'Maria A.',
    rating: '4.8',
    price: 'R$ 24,50',
    pickupDistance: '1.2km',
    pickup: 'Av. Paulista, 1000 - Bela Vista',
    destinationTime: '15 min',
    destination: 'R. Funchal, 418 - Vila Olimpia',
    accent: 'blue',
    status: 'pending',
  },
  {
    id: 2,
    initials: 'CP',
    passenger: 'Carlos P.',
    rating: '5.0',
    price: 'R$ 18,90',
    pickupDistance: '3.5km',
    pickup: 'Aeroporto de Congonhas',
    destinationTime: '22 min',
    destination: 'Av. Ibirapuera, 2000 - Moema',
    accent: 'violet',
    status: 'pending',
  },
]

export const initialTariffs = {
  perKm: '2,50',
  perMinute: '0,45',
  displacementFee: '5,00',
}

export const vehicleStatus = [
  { icon: '⛽', label: 'Combustivel', value: '75%' },
  { icon: '📏', label: 'Km Total', value: '45.230 km' },
  { icon: '🛠️', label: 'Manutencao', value: 'Em dia' },
  { icon: '✅', label: 'Documento', value: 'Regular' },
]
