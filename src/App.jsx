import React, { useState, useMemo, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';
import { 
  LayoutDashboard, Map as MapIcon, TrendingUp, ListTodo, AlertTriangle, 
  CheckCircle, Clock, Upload, Search, Building, Save, Download, CalendarRange, Trash2, Filter, Camera, ArrowLeft, ExternalLink
} from 'lucide-react';

// --- ROBUST CSV PARSER ---
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
                i++; 
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
                if (char === '\r') i++; 
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

// --- ROBUST REPORT PARSER (JSON DATA) ---
const processNBHTickets = (rows) => {
    if (!rows || rows.length === 0) return [];
    const data = [];

    for (let i = 0; i < rows.length; i++) {
        const rawRow = rows[i];
        const rowData = {};
        
        // Normalize keys (trim and remove hidden BOM characters)
        Object.keys(rawRow).forEach(key => {
            const cleanKey = key.trim().replace(/^\uFEFF/, '');
            rowData[cleanKey] = typeof rawRow[key] === 'string' ? rawRow[key].trim() : rawRow[key];
        });

        // Calculate TAT in hours (NBH Format: "6d 04h 14m" or "188h:38m:42s")
        let tatHours = null;
        const tatStr = String(rowData['Resolve Time (DD-HH-MM)'] || rowData['TAT_IN_Days_Hours'] || rowData['TAT_IN_HHMMSS'] || '');
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

        // Resilient field mappings across different NBH export versions & files
        const ticketId = rowData['Ticket ID'] || rowData['Ticket Id'] || rowData['ticket_id'] || rowData['Ticket_ID'];
        const loc = rowData['Issue Location'] || rowData['Unit'] || rowData['Issue_Location'] || rowData['Reported_from (Apartment)'];
        const cat = rowData['Category'] || rowData['category'] || rowData['Ticket_Category'];
        const subCat = rowData['Sub Category'] || rowData['sub_category'] || rowData['Ticket_Sub_Category'] || rowData['Sub-Category'];
        const prio = rowData['Priority'] || rowData['admin_priority'];
        const state = rowData['State'] || rowData['state'] || rowData['Status'] || rowData['Ticket_State'];
        const createdOnRaw = String(rowData['Created On'] || rowData['Created_Date'] || rowData['Ticket_Created_On'] || rowData['created_on'] || '');
        const createdBy = rowData['Created By'] || rowData['Created_by'] || rowData['Ticket_Created_By'];
        const desc = rowData['Description'] || rowData['description'] || rowData['Ticket_Description'] || rowData['Topic'];

        let block = 'Unknown';
        if (loc && String(loc).includes('-')) {
             block = String(loc).split('-')[0];
        } else if (loc) {
             block = String(loc);
        }

        // Only ingest rows that contain actual ticket IDs (ignores summary rows or completely unrelated files)
        if (ticketId && String(ticketId).trim() !== '' && String(ticketId) !== 'undefined') {
            data.push({
                id: String(ticketId),
                block: block,
                unit: loc || 'Unknown',
                category: cat && cat !== 'undefined' ? String(cat).toUpperCase().replace(/\s+/g, '_') : 'UNKNOWN',
                subCategory: subCat && subCat !== 'undefined' ? String(subCat).toUpperCase().replace(/\s+/g, '_') : 'N/A',
                priority: prio && prio !== 'undefined' ? String(prio).toUpperCase() : 'LOW',
                state: state && state !== 'undefined' ? String(state).toUpperCase() : 'OPEN',
                created: createdOnRaw && createdOnRaw !== 'undefined' && createdOnRaw !== 'N/A' ? createdOnRaw.split(' ')[0] : 'N/A',
                createdBy: createdBy && createdBy !== 'undefined' ? String(createdBy) : 'N/A',
                description: desc && desc !== 'undefined' ? String(desc).replace(/(\r\n|\n|\r)/gm, " ") : 'N/A',
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
  { id: '15211', block: '14A', unit: '14A-204', category: 'INTERNAL', subCategory: 'EMERGENCY', priority: 'HIGH', state: 'OPEN', created: '2026-05-08', createdBy: 'jayabalaji', description: 'Switch replacement', tatHours: null },
  { id: '13984', block: '24B', unit: '24B-301', category: 'COMMON_AREA', subCategory: 'ACCESS_DOOR', priority: 'MEDIUM', state: 'CLOSED', created: '2026-02-08', createdBy: 'Rajkumar', description: 'Need biometric access for 4 members in our house', tatHours: 44.3 },
  { id: '13983', block: '24B', unit: '24B-301', category: 'SECURITY_INCIDENT', subCategory: 'N/A', priority: 'MEDIUM', state: 'CLOSED', created: '2026-02-08', createdBy: 'Rajkumar', description: 'Need finger print acces for lal members', tatHours: 0.5 },
  { id: '13980', block: '46B', unit: '46B-310', category: 'INTERNAL', subCategory: 'NON_EMERGENCY_CARPENTRYPAID', priority: 'HIGH', state: 'CLOSED', created: '2026-02-08', createdBy: 'Girinath', description: 'Kichen door is stuck.', tatHours: 148.2 },
];

const COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'];

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [tickets, setTickets] = useState(mockTickets);
  const [zoneConfig, setZoneConfig] = useState(DEFAULT_ZONES);
  const [isUploading, setIsUploading] = useState(false);
  
  // Drill-down State
  const [selectedSubCategoryDetail, setSelectedSubCategoryDetail] = useState(null);

  // Registry Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [filterZone, setFilterZone] = useState('ALL');
  const [filterBlock, setFilterBlock] = useState('ALL');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [filterSubCategory, setFilterSubCategory] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  
  const [isMockData, setIsMockData] = useState(true);
  const [loadedDateRanges, setLoadedDateRanges] = useState([]);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [xlsxLoaded, setXlsxLoaded] = useState(false);

  // --- LOAD SHEETJS DYNAMICALLY TO BYPASS BUILD ERRORS ---
  useEffect(() => {
    if (window.XLSX) {
      setXlsxLoaded(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
    script.onload = () => setXlsxLoaded(true);
    document.body.appendChild(script);
  }, []);

  // --- LOAD HTML2CANVAS DYNAMICALLY FOR IMAGE EXPORT ---
  useEffect(() => {
    if (window.html2canvas) return;
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    document.body.appendChild(script);
  }, []);

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
        const readPromises = files.map(file => {
            // Use resolve instead of reject so a single bad file doesn't break Promise.all
            return new Promise((resolve) => {
                const reader = new FileReader();

                reader.onload = (e) => {
                    try {
                        const data = new Uint8Array(e.target.result);
                        
                        // Smart validation: Check if file is truly a ZIP archive (real Excel file) 
                        // by looking for the "PK" magic bytes at the start of the file.
                        const isRealZip = data.length > 2 && data[0] === 80 && data[1] === 75;

                        if (isRealZip) {
                            if (!window.XLSX) {
                                console.warn("Excel parser not loaded yet.");
                                return resolve([]);
                            }
                            try {
                                const workbook = window.XLSX.read(data, { type: 'array' });
                                const sheetName = workbook.SheetNames[0];
                                const worksheet = workbook.Sheets[sheetName];
                                const jsonRows = window.XLSX.utils.sheet_to_json(worksheet, { raw: false, defval: "" });
                                resolve(jsonRows);
                            } catch (xlsxErr) {
                                // Gracefully skip corrupted XLSX files that cause 'Bad uncompressed size' or 'Map2' crashes
                                console.warn(`Skipped ${file.name} due to Excel parsing error (corrupted file):`, xlsxErr);
                                resolve([]);
                            }
                        } else {
                            // If it's not a ZIP, treat it as plain text (CSV or HTML disguised as XLS).
                            const decoder = new TextDecoder('utf-8');
                            const text = decoder.decode(data);
                            
                            // Check if it's actually an HTML file disguised as .xls
                            const lowerText = text.slice(0, 500).trim().toLowerCase();
                            if (lowerText.startsWith('<html') || lowerText.startsWith('<table') || lowerText.startsWith('<!doctype html')) {
                                try {
                                    const workbook = window.XLSX.read(data, { type: 'array' });
                                    const sheetName = workbook.SheetNames[0];
                                    const worksheet = workbook.Sheets[sheetName];
                                    const jsonRows = window.XLSX.utils.sheet_to_json(worksheet, { raw: false, defval: "" });
                                    resolve(jsonRows);
                                } catch (htmlErr) {
                                    console.warn(`Skipped ${file.name}: Failed to parse HTML table.`);
                                    resolve([]);
                                }
                            } else if (text.slice(0, 1000).includes('\x00')) {
                                // Basic binary check: if it contains null bytes, it's not a valid CSV (likely a PDF/Image attachment)
                                console.warn(`Skipped ${file.name}: Appears to be an unsupported binary attachment.`);
                                resolve([]);
                            } else {
                                // Treat as standard CSV
                                const rows = parseCSV(text).filter(r => r.length > 0 && r.some(c => c && c.trim() !== ''));
                                if (rows.length === 0) return resolve([]);

                                const headers = rows[0].map(h => h ? h.trim().replace(/^\uFEFF/, '') : '');
                                const jsonRows = [];
                                
                                for (let i = 1; i < rows.length; i++) {
                                    const rowData = {};
                                    headers.forEach((header, index) => {
                                        rowData[header] = rows[i][index] ? rows[i][index].trim() : null;
                                    });
                                    jsonRows.push(rowData);
                                }
                                resolve(jsonRows);
                            }
                        }
                    } catch (error) {
                        console.error(`Unexpected error reading ${file.name}:`, error);
                        resolve([]);
                    }
                };
                
                reader.onerror = (e) => {
                    console.error(`FileReader error on ${file.name}`, e);
                    resolve([]);
                };
                
                // Read everything as ArrayBuffer first so we can check the magic bytes
                reader.readAsArrayBuffer(file);
            });
        });

        const fileContentsArray = await Promise.all(readPromises);
        let allNewTickets = [];

        // Parse each file and collect valid tickets
        for (const jsonRows of fileContentsArray) {
            if (jsonRows && jsonRows.length > 0) {
                const newTickets = processNBHTickets(jsonRows);
                allNewTickets = [...allNewTickets, ...newTickets];
            }
        }

        if (allNewTickets.length > 0) {
            // Deduplicate and MERGE tickets to enrich them with data from all reports
            const baseTickets = isMockData ? [] : tickets;
            const uniqueTicketsMap = new Map();
            
            // Seed map with existing tickets
            baseTickets.forEach(t => uniqueTicketsMap.set(t.id, t));

            allNewTickets.forEach(t => {
                if (uniqueTicketsMap.has(t.id)) {
                    // Merge fields, preferring concrete data over "UNKNOWN" or "N/A"
                    const existing = uniqueTicketsMap.get(t.id);
                    const merged = { ...existing };
                    Object.keys(t).forEach(key => {
                        const val = t[key];
                        if (val !== null && val !== 'UNKNOWN' && val !== 'N/A' && val !== 'Unknown') {
                            if (!merged[key] || merged[key] === 'UNKNOWN' || merged[key] === 'N/A' || merged[key] === 'Unknown') {
                                merged[key] = val;
                            } else if (key === 'tatHours' && val !== null) {
                                merged[key] = val; // Prioritize concrete numbers
                            }
                        }
                    });
                    uniqueTicketsMap.set(t.id, merged);
                } else {
                    uniqueTicketsMap.set(t.id, t);
                }
            });
            
            const consolidatedTickets = Array.from(uniqueTicketsMap.values());
            setTickets(consolidatedTickets);
            setIsMockData(false);

            // Update loaded date ranges
            const dateValues = consolidatedTickets
              .map(t => new Date(t.created).getTime())
              .filter(t => !isNaN(t));

            if (dateValues.length > 0) {
                const start = new Date(Math.min(...dateValues)).toISOString().split('T')[0];
                const end = new Date(Math.max(...dateValues)).toISOString().split('T')[0];
                setLoadedDateRanges([{ start, end }]);
            }
        } else {
            alert("No tickets found. Skipped invalid or corrupted files. Please ensure your files contain recognizable ticket data.");
        }
    } catch (err) {
        console.error(err);
        alert("An unexpected error occurred while compiling the reports.");
    }

    setIsUploading(false);
    event.target.value = ''; 
  };

  const handleClearData = () => {
    if (window.confirm("Are you sure you want to clear all loaded ticket data? This cannot be undone.")) {
      setTickets([]);
      setLoadedDateRanges([]);
      setIsMockData(false); 
      setFilterCategory('ALL');
      setFilterSubCategory('ALL');
      setFilterZone('ALL');
      setFilterBlock('ALL');
      setFilterStatus('ALL');
      setSearchTerm('');
      setSelectedSubCategoryDetail(null);
    }
  };

  const handleExport = () => {
    if (tickets.length === 0) return;
    
    // Add new fields to the consolidated export
    const headers = [
      'Ticket ID', 'Created Date', 'Created By', 'Location', 'Zone', 
      'Category', 'Sub-Category', 'Priority', 'Status', 'Description', 'TAT (Hrs)'
    ];
    const csvRows = [headers.join(',')];

    tickets.forEach(t => {
      // Clean Description to ensure CSV doesn't break
      const cleanDesc = t.description ? String(t.description).replace(/"/g, '""') : '';
      
      const row = [
        t.id, 
        t.created, 
        `"${t.createdBy || ''}"`,
        `"${t.unit || ''}"`, 
        `"${blockToZone[t.block] || 'Unassigned'}"`,
        t.category, 
        t.subCategory,
        t.priority, 
        t.state, 
        `"${cleanDesc}"`,
        t.tatHours !== null ? t.tatHours : ''
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

  const handleExportImage = async (elementId, filename) => {
    if (!window.html2canvas) {
      alert("Image export library is loading, please try again in a moment.");
      return;
    }
    
    const element = document.getElementById(elementId);
    if (!element) return;
    
    try {
      // Hide buttons temporarily so they aren't captured in the screenshot
      const exportBtns = element.querySelectorAll('.export-btn-hide');
      exportBtns.forEach(btn => btn.style.display = 'none');

      const canvas = await window.html2canvas(element, { 
        backgroundColor: '#f8fafc', // match the slate-50 background
        scale: 2, // high resolution
      }); 
      
      // Restore buttons
      exportBtns.forEach(btn => btn.style.display = '');

      const image = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = image;
      link.download = filename;
      link.click();
    } catch (err) {
      console.error("Error exporting image:", err);
      alert("Failed to export image.");
    }
  };

  // --- DRILL DOWN HANDLERS ---
  const drillDownToRegistry = (filterType, value) => {
    setActiveTab('tickets');
    setSelectedSubCategoryDetail(null); // Clear detail view if active
    if (filterType === 'zone') setFilterZone(value);
    if (filterType === 'block') setFilterBlock(value);
    if (filterType === 'category') setFilterCategory(value);
    if (filterType === 'subCategory') setFilterSubCategory(value);
    if (filterType === 'status') setFilterStatus(value);
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

  const subCategoryData = useMemo(() => {
    const counts = {};
    tickets.forEach(t => { 
      if(t.subCategory && t.subCategory !== 'N/A') {
        counts[t.subCategory] = (counts[t.subCategory] || 0) + 1; 
      }
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name: name.replace(/_/g, ' '), value }))
      .sort((a,b) => b.value - a.value)
      .slice(0, 15); // Top 15 to keep the chart readable
  }, [tickets]);

  const topBlocksData = useMemo(() => {
    const counts = {};
    tickets.forEach(t => { 
      if(t.block && t.block !== 'Unknown' && t.block !== 'N/A') {
        counts[t.block] = (counts[t.block] || 0) + 1; 
      }
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a,b) => b.value - a.value)
      .slice(0, 15); // Top 15 affected blocks
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

  const getUniqueCategories = useMemo(() => {
    const cats = new Set(tickets.map(t => t.category));
    return Array.from(cats).sort();
  }, [tickets]);

  const getUniqueSubCategories = useMemo(() => {
    const subCats = new Set(tickets.map(t => t.subCategory));
    return Array.from(subCats).sort();
  }, [tickets]);

  const getUniqueStatuses = useMemo(() => {
    const statuses = new Set(tickets.map(t => t.state));
    return Array.from(statuses).sort();
  }, [tickets]);

  // --- SUB-CATEGORY DETAIL VIEW LOGIC ---
  const handleSubCategoryClick = (name) => {
    setSelectedSubCategoryDetail(name);
  };

  const selectedSubCatStats = useMemo(() => {
    if (!selectedSubCategoryDetail) return null;
    const originalName = selectedSubCategoryDetail.replace(/ /g, '_');
    const filtered = tickets.filter(t => t.subCategory === originalName);
    
    const blockCounts = {};
    const zoneCounts = {};

    filtered.forEach(t => {
      if(t.block && t.block !== 'Unknown' && t.block !== 'N/A') {
        blockCounts[t.block] = (blockCounts[t.block] || 0) + 1;
      }
      const zone = blockToZone[t.block] || 'Unassigned';
      zoneCounts[zone] = (zoneCounts[zone] || 0) + 1;
    });

    const topBlocks = Object.entries(blockCounts)
      .map(([name, value]) => ({ name, value }))
      .sort((a,b) => b.value - a.value)
      .slice(0, 10);

    const topZones = Object.entries(zoneCounts)
      .map(([name, value]) => ({ name, value }))
      .sort((a,b) => b.value - a.value);

    return {
      total: filtered.length,
      topBlocks,
      topZones
    };
  }, [selectedSubCategoryDetail, tickets, blockToZone]);


  // --- VIEWS ---
  const renderSidebar = () => (
    <div className="w-64 bg-slate-900 text-slate-300 flex flex-col h-screen fixed left-0 top-0">
      <div className="p-6 flex items-center space-x-3 text-white border-b border-slate-800">
        <Building className="w-8 h-8 text-blue-500" />
        <span className="text-xl font-bold tracking-tight">FM Tracker</span>
      </div>
      
      <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
        <button onClick={() => { setActiveTab('dashboard'); setSelectedSubCategoryDetail(null); }} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'dashboard' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}>
          <LayoutDashboard className="w-5 h-5" /><span>Dashboard</span>
        </button>
        <button onClick={() => { setActiveTab('efficiency'); setSelectedSubCategoryDetail(null); }} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'efficiency' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}>
          <TrendingUp className="w-5 h-5" /><span>FM Efficiency</span>
        </button>
        <button onClick={() => { setActiveTab('zones'); setSelectedSubCategoryDetail(null); }} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'zones' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}>
          <MapIcon className="w-5 h-5" /><span>Zone Config</span>
        </button>
        <button onClick={() => { setActiveTab('tickets'); setSelectedSubCategoryDetail(null); }} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'tickets' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}>
          <ListTodo className="w-5 h-5" /><span>Ticket Registry</span>
        </button>
      </nav>

      <div className="p-4 border-t border-slate-800 space-y-2">
         <label className={`flex items-center justify-center space-x-2 ${xlsxLoaded ? 'bg-slate-800 hover:bg-slate-700 cursor-pointer' : 'bg-slate-800/50 cursor-not-allowed'} text-white px-4 py-3 rounded-lg transition-colors w-full`}>
            <Upload className="w-4 h-4" />
            <span className="text-sm font-medium">{isUploading ? 'Loading...' : (xlsxLoaded ? 'Merge Reports' : 'Initializing...')}</span>
            <input type="file" accept=".csv, .xlsx, .xls" multiple className="hidden" disabled={!xlsxLoaded || isUploading} onChange={handleFileUpload} />
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
               <span className="text-xs font-semibold uppercase tracking-wider">Loaded Snapshot</span>
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

  const renderSubCategoryDetail = () => {
    if (!selectedSubCategoryDetail || !selectedSubCatStats) return null;

    return (
      <div id="view-subcategory-detail" className="space-y-6 p-2 -m-2 rounded">
        <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div>
            <button 
              onClick={() => setSelectedSubCategoryDetail(null)} 
              className="flex items-center space-x-2 text-slate-500 hover:text-blue-600 mb-2 transition-colors text-sm font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Dashboard</span>
            </button>
            <h2 className="text-2xl font-bold text-slate-800 break-all">{selectedSubCategoryDetail}</h2>
            <p className="text-slate-500 mt-1">Detailed analysis for this specific sub-category across all records.</p>
          </div>
          <div className="flex flex-col items-end space-y-3">
            <div className="flex items-center space-x-2 text-sm text-slate-500 bg-slate-50 px-4 py-2 rounded-full border border-slate-200">
              <ListTodo className="w-4 h-4 text-blue-500" />
              <span><strong className="text-slate-800 text-lg">{selectedSubCatStats.total}</strong> Total Tickets</span>
            </div>
            <div className="flex space-x-2">
              <button 
                onClick={() => drillDownToRegistry('subCategory', selectedSubCategoryDetail.replace(/ /g, '_'))}
                className="export-btn-hide flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow-sm text-sm font-medium transition-colors"
                title="View these tickets in Registry"
              >
                <span>View Tickets</span>
                <ExternalLink className="w-4 h-4" />
              </button>
              <button 
                onClick={() => handleExportImage('view-subcategory-detail', `SubCategory_${selectedSubCategoryDetail}_${new Date().toISOString().split('T')[0]}.png`)}
                className="export-btn-hide flex items-center space-x-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-4 py-2 rounded-lg shadow-sm text-sm font-medium transition-colors"
                title="Export Details as Image"
              >
                <Camera className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col">
            <h3 className="text-lg font-semibold text-slate-800 mb-6">Affected Blocks for this Sub-Category</h3>
            <div className="flex-1 w-full min-h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={selectedSubCatStats.topBlocks} margin={{ top: 10, right: 10, left: -20, bottom: 40 }} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                  <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} width={80} />
                  <RechartsTooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                  <Bar 
                      dataKey="value" 
                      fill="#f59e0b" 
                      radius={[0, 4, 4, 0]} 
                      barSize={20} 
                      onClick={(data) => {
                          setFilterSubCategory(selectedSubCategoryDetail.replace(/ /g, '_'));
                          drillDownToRegistry('block', data.name);
                      }}
                      className="cursor-pointer hover:opacity-80"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-center text-slate-400 mt-2">Click on a bar to view tickets for this block</p>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col">
            <h3 className="text-lg font-semibold text-slate-800 mb-6">Zone Distribution</h3>
            <div className="flex-1 w-full min-h-[350px] flex justify-center items-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie 
                      data={selectedSubCatStats.topZones} 
                      cx="50%" cy="50%" innerRadius={80} outerRadius={110} paddingAngle={2} dataKey="value"
                      onClick={(data) => {
                          setFilterSubCategory(selectedSubCategoryDetail.replace(/ /g, '_'));
                          drillDownToRegistry('zone', data.name);
                      }}
                      className="cursor-pointer hover:opacity-80"
                  >
                    {selectedSubCatStats.topZones.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-center text-slate-400 mt-2">Click on a slice to view tickets for this zone</p>
          </div>
        </div>
      </div>
    );
  };

  const renderDashboard = () => {
    if (selectedSubCategoryDetail) {
      return renderSubCategoryDetail();
    }

    return (
      <div id="view-dashboard" className="space-y-6 p-2 -m-2 rounded">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Overview Dashboard</h2>
            <p className="text-slate-500 mt-1">Consolidated view of all loaded time periods.</p>
          </div>
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2 text-sm text-slate-500 bg-white px-4 py-2 rounded-full shadow-sm">
              <Clock className="w-4 h-4" />
              <span>Ticket Snapshot ({tickets.length} tickets)</span>
            </div>
            <button 
              onClick={() => handleExportImage('view-dashboard', `Dashboard_${new Date().toISOString().split('T')[0]}.png`)}
              className="export-btn-hide flex items-center space-x-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-4 py-2 rounded-full shadow-sm text-sm font-medium transition-colors"
              title="Export Dashboard as Image"
            >
              <Camera className="w-4 h-4" />
              <span>Screenshot</span>
            </button>
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
          <div 
              className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center space-x-4 cursor-pointer hover:border-amber-300 transition-colors"
              onClick={() => drillDownToRegistry('status', 'OPEN')}
              title="Click to view Open Tickets"
          >
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
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col">
            <h3 className="text-lg font-semibold text-slate-800 mb-6">Volume by Category</h3>
            <div className="flex-1 w-full min-h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                  <RechartsTooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                  <Bar 
                      dataKey="value" 
                      fill="#3b82f6" 
                      radius={[4, 4, 0, 0]} 
                      barSize={40} 
                      onClick={(data) => drillDownToRegistry('category', data.name.replace(/ /g, '_'))}
                      className="cursor-pointer hover:opacity-80"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-center text-slate-400 mt-2">Click on a bar to drill down into the category</p>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col">
            <h3 className="text-lg font-semibold text-slate-800 mb-6">Distribution by Zone</h3>
            <div className="flex-1 w-full min-h-[300px] flex justify-center items-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie 
                      data={zoneData} 
                      cx="50%" cy="50%" innerRadius={80} outerRadius={110} paddingAngle={2} dataKey="count"
                      onClick={(data) => drillDownToRegistry('zone', data.name)}
                      className="cursor-pointer hover:opacity-80"
                  >
                    {zoneData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-center text-slate-400 mt-2">Click on a slice to drill down into the zone</p>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col lg:col-span-2">
            <h3 className="text-lg font-semibold text-slate-800 mb-6">Top Volume by Sub-Category</h3>
            <div className="flex-1 w-full min-h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={subCategoryData} margin={{ top: 10, right: 10, left: -20, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#64748b', fontSize: 10}} 
                    interval={0} 
                    angle={-45} 
                    textAnchor="end" 
                    height={80} 
                  />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                  <RechartsTooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                  <Bar 
                      dataKey="value" 
                      fill="#8b5cf6" 
                      radius={[4, 4, 0, 0]} 
                      barSize={30} 
                      onClick={(data) => handleSubCategoryClick(data.name)}
                      className="cursor-pointer hover:opacity-80"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-center text-slate-400 mt-2">Click on a bar to view detailed analysis for the sub-category</p>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col lg:col-span-2">
            <h3 className="text-lg font-semibold text-slate-800 mb-6">Top Affected Blocks</h3>
            <div className="flex-1 w-full min-h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topBlocksData} margin={{ top: 10, right: 10, left: -20, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#64748b', fontSize: 10}} 
                    interval={0} 
                    angle={-45} 
                    textAnchor="end" 
                    height={80} 
                  />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                  <RechartsTooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                  <Bar 
                      dataKey="value" 
                      fill="#f59e0b" 
                      radius={[4, 4, 0, 0]} 
                      barSize={30} 
                      onClick={(data) => drillDownToRegistry('block', data.name)}
                      className="cursor-pointer hover:opacity-80"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-center text-slate-400 mt-2">Click on a bar to drill down into the block</p>
          </div>
        </div>
      </div>
    );
  };

  const renderEfficiency = () => (
    <div id="view-efficiency" className="space-y-6 p-2 -m-2 rounded">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Facility Management Efficiency</h2>
          <p className="text-slate-500 mt-1">Track turnaround times and ageing metrics across all uploaded time periods.</p>
        </div>
        <button 
          onClick={() => handleExportImage('view-efficiency', `Efficiency_${new Date().toISOString().split('T')[0]}.png`)}
          className="export-btn-hide flex items-center space-x-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-4 py-2 rounded-full shadow-sm text-sm font-medium transition-colors"
          title="Export Efficiency View as Image"
        >
          <Camera className="w-4 h-4" />
          <span>Screenshot</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col">
          <h3 className="text-lg font-semibold text-slate-800 mb-6">Average TAT by Category (Hours)</h3>
          <div className="flex-1 w-full min-h-[350px]">
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
                <RechartsTooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                <Area type="monotone" dataKey="avgTat" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorTat)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col h-[400px]">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Critical Ageing Alerts</h3>
          <div className="flex-1 overflow-y-auto space-y-4 pr-2">
            {tickets.filter(t => t.state === 'OPEN' && t.priority === 'HIGH').map((t, idx) => (
              <div key={idx} className="p-4 bg-red-50 rounded-xl border border-red-100 flex justify-between items-center">
                <div>
                  <p className="text-sm font-bold text-red-800">#{t.id} - {t.block}</p>
                  <p className="text-xs text-red-600 mt-1">{t.category.replace(/_/g, ' ')}</p>
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
    <div id="view-zones" className="space-y-6 p-2 -m-2 rounded">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Zone Configuration</h2>
          <p className="text-slate-500 mt-1">Map physical residential blocks to 8 management zones.</p>
        </div>
        <div className="flex items-center space-x-3">
          <button 
            onClick={saveZoneConfigToStorage}
            disabled={isSavingConfig}
            className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition-colors"
          >
            <Save className="w-4 h-4" />
            <span>{isSavingConfig ? 'Saving...' : 'Save Configuration'}</span>
          </button>
          <button 
            onClick={() => handleExportImage('view-zones', `Zones_${new Date().toISOString().split('T')[0]}.png`)}
            className="export-btn-hide flex items-center space-x-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-4 py-2 rounded-full shadow-sm text-sm font-medium transition-colors"
            title="Export Zones as Image"
          >
            <Camera className="w-4 h-4" />
            <span>Screenshot</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 lg:col-span-1">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Unassigned Blocks</h3>
          <div className="flex flex-wrap gap-2">
            {uniqueBlocks.filter(b => !blockToZone[b]).map(block => (
              <div key={block} className="flex items-center space-x-2 bg-slate-100 px-3 py-2 rounded-lg text-sm font-medium text-slate-700 border border-slate-200">
                <MapIcon className="w-4 h-4 text-slate-400" />
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
    // Apply filters
    const filteredTickets = tickets.filter(t => {
      const matchesSearch = t.id.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            t.block.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            t.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            t.subCategory.toLowerCase().includes(searchTerm.toLowerCase());
      
      const ticketZone = blockToZone[t.block] || 'Unassigned';
      const matchesZone = filterZone === 'ALL' || ticketZone === filterZone;
      const matchesBlock = filterBlock === 'ALL' || t.block === filterBlock;
      const matchesCategory = filterCategory === 'ALL' || t.category === filterCategory;
      const matchesSubCategory = filterSubCategory === 'ALL' || t.subCategory === filterSubCategory;
      const matchesStatus = filterStatus === 'ALL' || t.state === filterStatus;

      return matchesSearch && matchesZone && matchesBlock && matchesCategory && matchesSubCategory && matchesStatus;
    });

    return (
      <div id="view-registry" className="space-y-6 p-2 -m-2 rounded">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Ticket Registry</h2>
            <p className="text-slate-500 mt-1">Raw ticket master data containing all uploads.</p>
          </div>
          <div className="flex items-center space-x-4">
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
            <button 
              onClick={() => handleExportImage('view-registry', `Registry_${new Date().toISOString().split('T')[0]}.png`)}
              className="export-btn-hide flex items-center space-x-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-4 py-2 rounded-full shadow-sm text-sm font-medium transition-colors"
              title="Export Registry as Image"
            >
              <Camera className="w-4 h-4" />
              <span>Screenshot</span>
            </button>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-wrap items-center gap-4">
          <div className="flex items-center space-x-2 text-slate-500 text-sm font-medium mr-2">
            <Filter className="w-4 h-4" />
            <span>Filters:</span>
          </div>
          
          <select 
            value={filterZone} 
            onChange={(e) => setFilterZone(e.target.value)}
            className="bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2"
          >
            <option value="ALL">All Zones</option>
            {Object.keys(zoneConfig).map(z => <option key={z} value={z}>{z}</option>)}
            <option value="Unassigned">Unassigned</option>
          </select>

          <select 
            value={filterBlock} 
            onChange={(e) => setFilterBlock(e.target.value)}
            className="bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 max-w-[150px] truncate"
          >
            <option value="ALL">All Blocks</option>
            {uniqueBlocks.map(b => <option key={b} value={b}>{b}</option>)}
          </select>

          <select 
            value={filterCategory} 
            onChange={(e) => setFilterCategory(e.target.value)}
            className="bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 max-w-[200px] truncate"
          >
            <option value="ALL">All Categories</option>
            {getUniqueCategories.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
          </select>

          <select 
            value={filterSubCategory} 
            onChange={(e) => setFilterSubCategory(e.target.value)}
            className="bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 max-w-[200px] truncate"
          >
            <option value="ALL">All Sub-Categories</option>
            {getUniqueSubCategories.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
          </select>

          <select 
            value={filterStatus} 
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2"
          >
            <option value="ALL">All Statuses</option>
            {getUniqueStatuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <div className="ml-auto text-sm text-slate-500">
            Showing <span className="font-bold text-slate-800">{filteredTickets.length}</span> tickets
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
                  <th className="p-4">Category</th>
                  <th className="p-4">Sub-Category</th>
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
                    <td className="p-4">
                      {t.unit}
                      <div className="text-[10px] text-slate-400 font-semibold mt-0.5">
                        {blockToZone[t.block] || 'UNASSIGNED'}
                      </div>
                    </td>
                    <td className="p-4">{t.category.replace(/_/g, ' ')}</td>
                    <td className="p-4 text-slate-500 text-xs">{t.subCategory.replace(/_/g, ' ')}</td>
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
                        t.state === 'CLOSED' || t.state === 'RESOLVED' || t.state === 'AUTO_CLOSE' ? 'bg-emerald-100 text-emerald-800' :
                        'bg-slate-100 text-slate-800'
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
                      No tickets found matching your filters.
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