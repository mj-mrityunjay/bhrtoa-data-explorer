import React, { useState, useMemo, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';
import { 
  LayoutDashboard, Map, TrendingUp, ListTodo, AlertTriangle, 
  CheckCircle, Clock, Upload, Search, Building, Save, Download, CalendarRange, Trash2
} from 'lucide-react';

// --- ROBUST CSV PARSER ---
// This parser correctly handles CSV cells containing newlines, commas inside quotes, and escaped quotes.
const parseCSV = (text) => {
    const result = [];
    let row = [];
    let curVal = '';
    let inQuotes = false;
    
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (inQuotes) {
            if (char === '"' && nextChar === '"') {
                curVal += '"';
                i++; // Skip the escaped quote
            } else if (char === '"') {
                inQuotes = false;
            } else {
                curVal += char;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
            } else if (char === ',') {
                row.push(curVal);
                curVal = '';
            } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
                if (char === '\r') i++; // Skip \n of \r\n
                row.push(curVal);
                result.push(row);
                row = [];
                curVal = '';
            } else if (char !== '\r') {
                curVal += char;
            }
        }
    }
    if (curVal !== '' || text[text.length - 1] === ',' || row.length > 0) {
        row.push(curVal);
        result.push(row);
    }
    return result;
};

const parseNBHReport = (csvText) => {
    const rows = parseCSV(csvText).filter(r => r.length > 0 && r.some(c => c && c.trim() !== ''));
    if (rows.length === 0) return [];

    // Strip BOM from the first header just in case, and trim headers
    const headers = rows[0].map(h => h ? h.trim().replace(/^\uFEFF/, '') : '');
    const data = [];

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rowData = {};
        headers.forEach((header, index) => {
            rowData[header] = row[index] ? row[index].trim() : null;
        });

        // Calculate TAT in hours (NBH Format: "6d 04h 14m" or "188h:38m:42s")
        let tatHours = null;
        const tatStr = rowData['Resolve Time (DD-HH-MM)'] || rowData['TAT_IN_Days_Hours'] || rowData['TAT_IN_HHMMSS'];
        if (tatStr) {
            const daysMatch = tatStr.match(/(\d+)d\s+(\d+)h\s+(\d+)m/);
            if (daysMatch) {
                tatHours = parseInt(daysMatch[1], 10) * 24 + parseInt(daysMatch[2], 10) + (parseInt(daysMatch[3], 10) / 60);
            } else {
                const hrsMatch = tatStr.match(/(\d+)h:(\d+)m:(\d+)s/);
                if (hrsMatch) {
                    tatHours = parseInt(hrsMatch[1], 10) + (parseInt(hrsMatch[2], 10) / 60);
                }
            }
        }

        // Resilient field mappings across different NBH export versions
        const ticketId = rowData['Ticket ID'] || rowData['Ticket Id'] || rowData['ticket_id'] || rowData['Ticket_ID'];
        const loc = rowData['Issue Location'] || rowData['Unit'] || rowData['Issue_Location'];
        const cat = rowData['Category'] || rowData['category'] || rowData['Ticket_Category'];
        const prio = rowData['Priority'] || rowData['admin_priority'];
        const state = rowData['State'] || rowData['state'] || rowData['Status'] || rowData['Ticket_State'];
        const createdOnRaw = rowData['Created On'] || rowData['Created_Date'] || rowData['Ticket_Created_On'] || rowData['created_on'];

        let block = 'Unknown';
        if (loc) {
             block = loc.split('-')[0];
        }

        if (ticketId) {
            data.push({
                id: ticketId,
                block: block,
                unit: loc || 'Unknown',
                category: cat ? cat.toUpperCase().replace(/\s+/g, '_') : 'UNKNOWN',
                priority: prio ? prio.toUpperCase() : 'LOW',
                state: state ? state.toUpperCase() : 'OPEN',
                created: createdOnRaw ? createdOnRaw.split(' ')[0] : 'N/A',
                tatHours: tatHours
            });
        }
    }
    return data;
};

// Default setup with 8 zones
const DEFAULT_ZONES = {
  'Zone 1': ['14A', '18A'],
  'Zone 2': ['24B', '28B'],
  'Zone 3': ['33B', '36A'],
  'Zone 4': ['37B', '39A'],
  'Zone 5': ['46B', '57'],
  'Zone 6': ['PHARMACY'],
  'Zone 7': [],
  'Zone 8': []
};

const mockTickets = [
  { id: '15211', block: '14A', unit: '14A-204', category: 'INTERNAL', priority: 'HIGH', state: 'OPEN', created: '2026-05-08', tatHours: null },
  { id: '13984', block: '24B', unit: '24B-301', category: 'COMMON_AREA', priority: 'MEDIUM', state: 'CLOSED', created: '2026-02-08', tatHours: 44.3 },
  { id: '13983', block: '24B', unit: '24B-301', category: 'SECURITY_INCIDENT', priority: 'MEDIUM', state: 'CLOSED', created: '2026-02-08', tatHours: 0.5 },
  { id: '13980', block: '46B', unit: '46B-310', category: 'INTERNAL', priority: 'HIGH', state: 'CLOSED', created: '2026-02-08', tatHours: 148.2 },
];

const COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'];

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [tickets, setTickets] = useState(mockTickets);
  const [zoneConfig, setZoneConfig] = useState(DEFAULT_ZONES);
  const [isUploading, setIsUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Track state for combined files and dates
  const [isMockData, setIsMockData] = useState(true);
  const [loadedDateRanges, setLoadedDateRanges] = useState([]);

  // Persistence state
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  // --- LOAD SAVED ZONES VIA NATIVE INDEXED_DB ---
  useEffect(() => {
    try {
      const request = indexedDB.open('FMDashboardDB', 1);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
      };

      request.onsuccess = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('settings')) return;
        
        const tx = db.transaction('settings', 'readonly');
        const store = tx.objectStore('settings');
        const getReq = store.get('zoneConfig');
        
        getReq.onsuccess = (e) => {
          if (e.target.result) {
            setZoneConfig(e.target.result);
          }
        };
      };
    } catch (err) {
      console.error("Could not load saved zones:", err);
    }
  }, []);

  // --- SAVE ZONES VIA NATIVE INDEXED_DB ---
  const saveZoneConfigToStorage = () => {
    setIsSavingConfig(true);
    try {
      const request = indexedDB.open('FMDashboardDB', 1);
      
      request.onsuccess = (event) => {
        const db = event.target.result;
        const tx = db.transaction('settings', 'readwrite');
        const store = tx.objectStore('settings');
        
        store.put(zoneConfig, 'zoneConfig');
        
        tx.oncomplete = () => {
          setIsSavingConfig(false);
          alert("Zone Configuration saved securely for next time!");
        };
        
        tx.onerror = () => {
          setIsSavingConfig(false);
          alert("Error saving zone configuration.");
        };
      };
      
      request.onerror = () => {
        setIsSavingConfig(false);
        alert("Database access denied. Cannot save settings.");
      };
    } catch (err) {
      console.error("Failed to save zones:", err);
      setIsSavingConfig(false);
      alert("Error saving zone configuration.");
    }
  };

  // --- HANDLERS ---
  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    setIsUploading(true);
    
    try {
        // Read all files simultaneously
        const readPromises = files.map(file => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = (e) => reject(e);
                reader.readAsText(file);
            });
        });

        const fileContents = await Promise.all(readPromises);
        let allNewTickets = [];

        // Parse each file and combine the results
        for (const text of fileContents) {
            const newTickets = parseNBHReport(text);
            allNewTickets = [...allNewTickets, ...newTickets];
        }

        if (allNewTickets.length > 0) {
            // Deduplicate tickets internally in case multiple files contain the same ticket ID
            const uniqueTicketsMap = new Map();
            allNewTickets.forEach(t => uniqueTicketsMap.set(t.id, t));
            const uniqueNewTickets = Array.from(uniqueTicketsMap.values());

            // Calculate Min/Max dates to prevent duplicate overlaps with previously loaded data
            const dateValues = uniqueNewTickets
              .map(t => new Date(t.created).getTime())
              .filter(t => !isNaN(t));

            let start = 'Unknown', end = 'Unknown', hasOverlap = false;

            if (dateValues.length > 0) {
                start = new Date(Math.min(...dateValues)).toISOString().split('T')[0];
                end = new Date(Math.max(...dateValues)).toISOString().split('T')[0];

                if (!isMockData) {
                    hasOverlap = loadedDateRanges.some(range => {
                        return (start <= range.end && end >= range.start);
                    });
                }
            }

            if (hasOverlap) {
                alert(`⚠️ OVERLAP DETECTED!\n\nThe uploaded file(s) cover ${start} to ${end}. You already have overlapping data loaded. Please upload only unique time periods to avoid duplicate records.`);
                setIsUploading(false);
                event.target.value = ''; // Reset input
                return;
            }

            if (isMockData) {
                setTickets(uniqueNewTickets);
                setLoadedDateRanges(start !== 'Unknown' ? [{ start, end }] : []);
                setIsMockData(false);
            } else {
                // Filter out existing IDs just in case there's overlap in identical ticket IDs
                const existingIds = new Set(tickets.map(t => t.id));
                const trulyNewTickets = uniqueNewTickets.filter(t => !existingIds.has(t.id));
                
                setTickets(prev => [...prev, ...trulyNewTickets]);
                if (start !== 'Unknown') {
                    setLoadedDateRanges(prev => 
                       [...prev, { start, end }].sort((a, b) => a.start.localeCompare(b.start))
                    );
                }
            }
        } else {
            alert("No tickets found. Please ensure they are valid NBH Ticket Export Reports.");
        }
    } catch (err) {
        console.error(err);
        alert("Error parsing CSV files. Please ensure they are valid NBH Ageing Reports.");
    }

    setIsUploading(false);
    event.target.value = ''; // Reset input
  };

  const handleClearData = () => {
    if (window.confirm("Are you sure you want to clear all loaded ticket data? This cannot be undone.")) {
      setTickets([]);
      setLoadedDateRanges([]);
      setIsMockData(false); // Make sure we don't go back to mock data
    }
  };

  const handleExport = () => {
    if (tickets.length === 0) return;
    const headers = ['Ticket ID', 'Created Date', 'Location', 'Zone', 'Category', 'Priority', 'Status', 'TAT (Hrs)'];
    const csvRows = [headers.join(',')];

    tickets.forEach(t => {
      const row = [
        t.id, t.created, `"${t.unit || ''}"`, `"${blockToZone[t.block] || 'Unassigned'}"`,
        t.category, t.priority, t.state, t.tatHours !== null ? t.tatHours : ''
      ];
      csvRows.push(row.join(','));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fm_consolidated_report_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // --- DATA PROCESSING ---
  const uniqueBlocks = useMemo(() => {
    const blocks = new Set(tickets.map(t => t.block).filter(Boolean));
    return Array.from(blocks).sort();
  }, [tickets]);

  const blockToZone = useMemo(() => {
    const mapping = {};
    Object.entries(zoneConfig).forEach(([zone, blocks]) => {
      blocks.forEach(b => { mapping[b] = zone; });
    });
    return mapping;
  }, [zoneConfig]);

  const stats = useMemo(() => {
    const total = tickets.length;
    const open = tickets.filter(t => t.state === 'OPEN').length;
    const resolvedOrClosed = tickets.filter(t => ['RESOLVED', 'CLOSED', 'AUTO_CLOSE'].includes(t.state)).length;
    const resolutionRate = total ? Math.round((resolvedOrClosed / total) * 100) : 0;
    
    const tatTickets = tickets.filter(t => t.tatHours !== null);
    const avgTat = tatTickets.length 
      ? (tatTickets.reduce((acc, t) => acc + t.tatHours, 0) / tatTickets.length).toFixed(1)
      : 0;

    return { total, open, resolutionRate, avgTat };
  }, [tickets]);

  const categoryData = useMemo(() => {
    const counts = {};
    tickets.forEach(t => { counts[t.category] = (counts[t.category] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name: name.replace('_', ' '), value })).sort((a,b) => b.value - a.value);
  }, [tickets]);

  const zoneData = useMemo(() => {
    const counts = {};
    Object.keys(zoneConfig).forEach(z => counts[z] = 0);
    counts['Unassigned'] = 0;

    tickets.forEach(t => {
      const zone = blockToZone[t.block] || 'Unassigned';
      counts[zone] = (counts[zone] || 0) + 1;
    });
    return Object.entries(counts).map(([name, count]) => ({ name, count })).filter(d => d.count > 0);
  }, [tickets, blockToZone, zoneConfig]);

  const efficiencyData = useMemo(() => {
    const categoryTat = {};
    const categoryCount = {};
    
    tickets.filter(t => t.tatHours !== null).forEach(t => {
      categoryTat[t.category] = (categoryTat[t.category] || 0) + t.tatHours;
      categoryCount[t.category] = (categoryCount[t.category] || 0) + 1;
    });

    return Object.entries(categoryTat).map(([category, totalTat]) => ({
      category: category.replace('_', ' '),
      avgTat: Math.round(totalTat / categoryCount[category])
    }));
  }, [tickets]);

  const moveBlockToZone = (block, targetZone) => {
    setZoneConfig(prev => {
      const newConfig = { ...prev };
      Object.keys(newConfig).forEach(z => {
        newConfig[z] = newConfig[z].filter(b => b !== block);
      });
      if (targetZone !== 'Unassigned') {
        if (!newConfig[targetZone]) newConfig[targetZone] = [];
        newConfig[targetZone].push(block);
      }
      return newConfig;
    });
  };

  // --- VIEWS ---
  const renderSidebar = () => (
    <div className="w-64 bg-slate-900 text-slate-300 flex flex-col h-screen fixed left-0 top-0">
      <div className="p-6 flex items-center space-x-3 text-white border-b border-slate-800">
        <Building className="w-8 h-8 text-blue-500" />
        <span className="text-xl font-bold tracking-tight">FM Tracker</span>
      </div>
      
      <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
        <button onClick={() => setActiveTab('dashboard')} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'dashboard' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}>
          <LayoutDashboard className="w-5 h-5" /><span>Dashboard</span>
        </button>
        <button onClick={() => setActiveTab('efficiency')} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'efficiency' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}>
          <TrendingUp className="w-5 h-5" /><span>FM Efficiency</span>
        </button>
        <button onClick={() => setActiveTab('zones')} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'zones' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}>
          <Map className="w-5 h-5" /><span>Zone Config</span>
        </button>
        <button onClick={() => setActiveTab('tickets')} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'tickets' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}>
          <ListTodo className="w-5 h-5" /><span>Ticket Registry</span>
        </button>
      </nav>

      <div className="p-4 border-t border-slate-800 space-y-2">
         <label className="flex items-center justify-center space-x-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-3 rounded-lg cursor-pointer transition-colors w-full">
            <Upload className="w-4 h-4" />
            <span className="text-sm font-medium">{isUploading ? 'Loading...' : 'Upload Report CSVs'}</span>
            <input type="file" accept=".csv" multiple className="hidden" onChange={handleFileUpload} />
         </label>
         
         <div className="flex space-x-2">
           <button onClick={handleExport} className="flex-1 flex items-center justify-center space-x-2 bg-blue-900/40 hover:bg-blue-900/80 text-blue-300 hover:text-blue-200 border border-blue-800/50 px-2 py-3 rounded-lg cursor-pointer transition-colors" title="Export CSV">
              <Download className="w-4 h-4" />
              <span className="text-xs font-medium">Export</span>
           </button>
           <button onClick={handleClearData} className="flex-1 flex items-center justify-center space-x-2 bg-red-900/20 hover:bg-red-900/40 text-red-400 hover:text-red-300 border border-red-800/30 px-2 py-3 rounded-lg cursor-pointer transition-colors" title="Clear All Data">
              <Trash2 className="w-4 h-4" />
              <span className="text-xs font-medium">Clear</span>
           </button>
         </div>
         
         {!isMockData && loadedDateRanges.length > 0 && (
           <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 mt-3">
             <div className="flex items-center space-x-2 text-slate-400 mb-2">
               <CalendarRange className="w-4 h-4" />
               <span className="text-xs font-semibold uppercase tracking-wider">Loaded Periods</span>
             </div>
             <div className="space-y-1">
               {loadedDateRanges.map((r, i) => (
                 <div key={i} className="text-[10px] text-slate-500 bg-slate-900 px-2 py-1 rounded">
                   {r.start} to {r.end}
                 </div>
               ))}
             </div>
           </div>
         )}
      </div>
    </div>
  );

  const renderDashboard = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Overview Dashboard</h2>
          <p className="text-slate-500 mt-1">Consolidated view of all loaded time periods.</p>
        </div>
        <div className="flex items-center space-x-2 text-sm text-slate-500 bg-white px-4 py-2 rounded-full shadow-sm">
          <Clock className="w-4 h-4" />
          <span>Ticket Snapshot ({tickets.length} tickets)</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center space-x-4">
          <div className="p-4 bg-blue-50 text-blue-600 rounded-xl"><ListTodo className="w-6 h-6" /></div>
          <div>
            <p className="text-sm font-medium text-slate-500">Total Tickets</p>
            <h3 className="text-3xl font-bold text-slate-800">{stats.total}</h3>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center space-x-4">
          <div className="p-4 bg-amber-50 text-amber-600 rounded-xl"><AlertTriangle className="w-6 h-6" /></div>
          <div>
            <p className="text-sm font-medium text-slate-500">Open Tickets</p>
            <h3 className="text-3xl font-bold text-slate-800">{stats.open}</h3>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center space-x-4">
          <div className="p-4 bg-emerald-50 text-emerald-600 rounded-xl"><CheckCircle className="w-6 h-6" /></div>
          <div>
            <p className="text-sm font-medium text-slate-500">Resolution Rate</p>
            <h3 className="text-3xl font-bold text-slate-800">{stats.resolutionRate}%</h3>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center space-x-4">
          <div className="p-4 bg-purple-50 text-purple-600 rounded-xl"><Clock className="w-6 h-6" /></div>
          <div>
            <p className="text-sm font-medium text-slate-500">Avg TAT (Hrs)</p>
            <h3 className="text-3xl font-bold text-slate-800">{stats.avgTat}</h3>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800 mb-6">Volume by Category</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800 mb-6">Distribution by Zone</h3>
          <div className="h-72 flex justify-center items-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={zoneData} cx="50%" cy="50%" innerRadius={80} outerRadius={110} paddingAngle={2} dataKey="count">
                  {zoneData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                <Legend verticalAlign="bottom" height={36} iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );

  const renderEfficiency = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Facility Management Efficiency</h2>
        <p className="text-slate-500 mt-1">Track turnaround times and ageing metrics across all uploaded time periods.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800 mb-6">Average TAT by Category (Hours)</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={efficiencyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorTat" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="category" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                <Area type="monotone" dataKey="avgTat" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorTat)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col h-96 lg:h-auto">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Critical Ageing Alerts</h3>
          <div className="flex-1 overflow-y-auto space-y-4 pr-2">
            {tickets.filter(t => t.state === 'OPEN' && t.priority === 'HIGH').map((t, idx) => (
              <div key={idx} className="p-4 bg-red-50 rounded-xl border border-red-100 flex justify-between items-center">
                <div>
                  <p className="text-sm font-bold text-red-800">#{t.id} - {t.block}</p>
                  <p className="text-xs text-red-600 mt-1">{t.category.replace('_', ' ')}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-red-500 font-medium">Created</p>
                  <p className="text-sm font-semibold text-red-700">{t.created}</p>
                </div>
              </div>
            ))}
            {tickets.filter(t => t.state === 'OPEN' && t.priority === 'HIGH').length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2 py-10">
                <CheckCircle className="w-10 h-10 text-emerald-400" />
                <p className="text-sm font-medium">No critical open tickets.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderZoneConfig = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Zone Configuration</h2>
          <p className="text-slate-500 mt-1">Map physical residential blocks to 8 management zones.</p>
        </div>
        <button 
          onClick={saveZoneConfigToStorage}
          disabled={isSavingConfig}
          className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition-colors"
        >
          <Save className="w-4 h-4" />
          <span>{isSavingConfig ? 'Saving...' : 'Save Configuration'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 lg:col-span-1">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Unassigned Blocks</h3>
          <div className="flex flex-wrap gap-2">
            {uniqueBlocks.filter(b => !blockToZone[b]).map(block => (
              <div key={block} className="flex items-center space-x-2 bg-slate-100 px-3 py-2 rounded-lg text-sm font-medium text-slate-700 border border-slate-200">
                <Map className="w-4 h-4 text-slate-400" />
                <span>{block}</span>
                <select 
                  className="ml-2 text-xs bg-white border-slate-300 rounded outline-none p-1"
                  onChange={(e) => moveBlockToZone(block, e.target.value)}
                  defaultValue="Unassigned"
                >
                  <option value="Unassigned">Assign...</option>
                  {Object.keys(zoneConfig).map(z => <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
            ))}
            {uniqueBlocks.filter(b => !blockToZone[b]).length === 0 && (
              <p className="text-sm text-slate-500 italic">All known blocks assigned.</p>
            )}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 lg:col-span-2">
          <h3 className="text-lg font-semibold text-slate-800 mb-6">Defined Zones (8)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(zoneConfig).map(([zone, blocks]) => (
              <div key={zone} className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="font-bold text-slate-800">{zone}</h4>
                  <span className={`text-xs px-2 py-1 rounded-full font-bold ${blocks.length > 0 ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-500'}`}>
                    {blocks.length} Blocks
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {blocks.map(block => (
                    <div key={block} className="bg-white border border-slate-200 shadow-sm px-2 py-1 rounded text-xs font-medium text-slate-600 flex items-center group">
                      {block}
                      <button onClick={() => moveBlockToZone(block, 'Unassigned')} className="ml-2 text-slate-400 hover:text-red-500 font-bold transition-colors">×</button>
                    </div>
                  ))}
                  {blocks.length === 0 && <span className="text-xs text-slate-400 py-1">Empty Zone</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const renderTicketRegistry = () => {
    const filteredTickets = tickets.filter(t => 
      t.id.toLowerCase().includes(searchTerm.toLowerCase()) || 
      t.block.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.category.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Ticket Registry</h2>
            <p className="text-slate-500 mt-1">Raw ticket master data containing all uploads.</p>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search ID, block or category..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 w-64" 
            />
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-xs uppercase text-slate-500 font-semibold tracking-wider">
                  <th className="p-4">Ticket ID</th>
                  <th className="p-4">Created Date</th>
                  <th className="p-4">Location</th>
                  <th className="p-4">Zone</th>
                  <th className="p-4">Category</th>
                  <th className="p-4">Priority</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">TAT (Hrs)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredTickets.map((t, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4 font-medium text-slate-800">#{t.id}</td>
                    <td className="p-4 text-slate-500">{t.created}</td>
                    <td className="p-4">{t.unit}</td>
                    <td className="p-4">
                      <span className="px-2 py-1 bg-slate-100 rounded text-xs font-medium text-slate-600">
                        {blockToZone[t.block] || 'Unassigned'}
                      </span>
                    </td>
                    <td className="p-4">{t.category.replace('_', ' ')}</td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                        t.priority === 'HIGH' ? 'bg-red-100 text-red-700' : 
                        t.priority === 'MEDIUM' ? 'bg-amber-100 text-amber-700' : 
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {t.priority}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${
                        t.state === 'OPEN' ? 'bg-amber-100 text-amber-800' : 
                        'bg-emerald-100 text-emerald-800'
                      }`}>
                        {t.state}
                      </span>
                    </td>
                    <td className="p-4 font-medium text-slate-700">
                      {t.tatHours !== null ? t.tatHours.toFixed(1) : '-'}
                    </td>
                  </tr>
                ))}
                {filteredTickets.length === 0 && (
                  <tr>
                    <td colSpan="8" className="p-8 text-center text-slate-500">
                      No tickets found matching your search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex bg-slate-50 min-h-screen font-sans">
      {renderSidebar()}
      <div className="flex-1 ml-64 p-8">
        {activeTab === 'dashboard' && renderDashboard()}
        {activeTab === 'efficiency' && renderEfficiency()}
        {activeTab === 'zones' && renderZoneConfig()}
        {activeTab === 'tickets' && renderTicketRegistry()}
      </div>
    </div>
  );
}