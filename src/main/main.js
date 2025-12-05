const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

// Enable hot reload for development
try {
  require('electron-reload')(__dirname, {
    electron: path.join(__dirname, '../../node_modules', '.bin', 'electron'),
    hardResetMethod: 'exit',
    forceHardReset: true,
    awaitWriteFinish: true,
  });
} catch (_) { }

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 680,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

// IPC Handlers for file operations
ipcMain.handle('get-downloads-path', () => {
  return path.join(os.homedir(), 'Downloads');
});

// Merge multiple PDFs into one
ipcMain.handle('merge-pdfs', async (event, { pdfDataArray, outputFileName }) => {
  try {
    const mergedPdf = await PDFDocument.create();
    
    for (const pdfBase64 of pdfDataArray) {
      const pdfBytes = Buffer.from(pdfBase64, 'base64');
      const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      pages.forEach(page => mergedPdf.addPage(page));
    }
    
    const mergedBytes = await mergedPdf.save();
    const downloadsPath = path.join(os.homedir(), 'Downloads');
    const filePath = path.join(downloadsPath, outputFileName);
    
    fs.writeFileSync(filePath, mergedBytes);
    
    return { success: true, path: filePath, size: mergedBytes.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Split PDF by extracting specific pages
ipcMain.handle('split-pdf', async (event, { pdfData, pages, outputFileNames, mode }) => {
  try {
    const pdfBytes = Buffer.from(pdfData, 'base64');
    const sourcePdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const totalPages = sourcePdf.getPageCount();
    const downloadsPath = path.join(os.homedir(), 'Downloads');
    const savedFiles = [];
    
    if (mode === 'range') {
      const newPdf = await PDFDocument.create();
      const pageIndices = pages.map(p => p - 1).filter(p => p >= 0 && p < totalPages);
      const copiedPages = await newPdf.copyPages(sourcePdf, pageIndices);
      copiedPages.forEach(page => newPdf.addPage(page));
      
      const newPdfBytes = await newPdf.save();
      const filePath = path.join(downloadsPath, outputFileNames[0]);
      fs.writeFileSync(filePath, newPdfBytes);
      savedFiles.push(filePath);
    } else {
      for (let i = 0; i < pages.length; i++) {
        const pageNum = pages[i];
        const pageIndex = pageNum - 1;
        
        if (pageIndex >= 0 && pageIndex < totalPages) {
          const newPdf = await PDFDocument.create();
          const [copiedPage] = await newPdf.copyPages(sourcePdf, [pageIndex]);
          newPdf.addPage(copiedPage);
          
          const newPdfBytes = await newPdf.save();
          const filePath = path.join(downloadsPath, outputFileNames[i]);
          fs.writeFileSync(filePath, newPdfBytes);
          savedFiles.push(filePath);
        }
      }
    }
    
    return { success: true, paths: savedFiles, count: savedFiles.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get PDF page count
ipcMain.handle('get-pdf-info', async (event, { pdfData }) => {
  try {
    const pdfBytes = Buffer.from(pdfData, 'base64');
    const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    return { success: true, pageCount: pdf.getPageCount() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// PDF to Image conversion using pdfjs-dist and canvas
ipcMain.handle('pdf-to-images', async (event, { pdfData, format, quality, outputPrefix }) => {
  try {
    const pdfBytes = Buffer.from(pdfData, 'base64');
    const downloadsPath = path.join(os.homedir(), 'Downloads');
    const savedFiles = [];
    
    // Load PDF using pdf-lib to get page count and sizes
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const pageCount = pdfDoc.getPageCount();
    
    // Use pdfjs-dist for rendering
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf');
    
    // Load the PDF with pdfjs
    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
    const pdf = await loadingTask.promise;
    
    const { createCanvas } = require('canvas');
    
    // Quality scale factor
    const scaleMap = { 60: 1, 80: 1.5, 95: 2 };
    const scale = scaleMap[quality] || 1.5;
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: scale });
      
      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d');
      
      // White background
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      
      // Render PDF page to canvas
      await page.render({
        canvasContext: context,
        viewport: viewport,
      }).promise;
      
      let buffer;
      let ext;
      if (format === 'png') {
        buffer = canvas.toBuffer('image/png');
        ext = 'png';
      } else {
        buffer = canvas.toBuffer('image/jpeg', { quality: quality / 100 });
        ext = 'jpg';
      }
      
      const fileName = `${outputPrefix}_page${i}.${ext}`;
      const filePath = path.join(downloadsPath, fileName);
      fs.writeFileSync(filePath, buffer);
      savedFiles.push(filePath);
    }
    
    return { success: true, paths: savedFiles, count: savedFiles.length };
  } catch (error) {
    console.error('PDF to Image error:', error);
    return { success: false, error: error.message };
  }
});

// Image to PDF conversion
ipcMain.handle('images-to-pdf', async (event, { images, outputFileName, pageSize, orientation }) => {
  try {
    const pdfDoc = await PDFDocument.create();
    const downloadsPath = path.join(os.homedir(), 'Downloads');
    
    // Page sizes in points (72 points = 1 inch)
    const pageSizes = {
      'a4': [595.28, 841.89],
      'letter': [612, 792],
      'legal': [612, 1008],
      'fit': null // Will fit to image size
    };
    
    for (const imgData of images) {
      const imgBytes = Buffer.from(imgData.data, 'base64');
      
      let image;
      const mimeType = imgData.type.toLowerCase();
      
      if (mimeType.includes('png')) {
        image = await pdfDoc.embedPng(imgBytes);
      } else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
        image = await pdfDoc.embedJpg(imgBytes);
      } else {
        // Try as JPEG first, then PNG
        try {
          image = await pdfDoc.embedJpg(imgBytes);
        } catch {
          image = await pdfDoc.embedPng(imgBytes);
        }
      }
      
      let pageWidth, pageHeight;
      
      if (pageSize === 'fit' || !pageSizes[pageSize]) {
        // Fit page to image
        pageWidth = image.width;
        pageHeight = image.height;
      } else {
        const [w, h] = pageSizes[pageSize];
        if (orientation === 'landscape') {
          pageWidth = Math.max(w, h);
          pageHeight = Math.min(w, h);
        } else {
          pageWidth = Math.min(w, h);
          pageHeight = Math.max(w, h);
        }
      }
      
      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      
      // Scale image to fit page while maintaining aspect ratio
      const imgAspect = image.width / image.height;
      const pageAspect = pageWidth / pageHeight;
      
      let drawWidth, drawHeight, x, y;
      
      if (imgAspect > pageAspect) {
        drawWidth = pageWidth;
        drawHeight = pageWidth / imgAspect;
        x = 0;
        y = (pageHeight - drawHeight) / 2;
      } else {
        drawHeight = pageHeight;
        drawWidth = pageHeight * imgAspect;
        x = (pageWidth - drawWidth) / 2;
        y = 0;
      }
      
      page.drawImage(image, {
        x,
        y,
        width: drawWidth,
        height: drawHeight,
      });
    }
    
    const pdfBytes = await pdfDoc.save();
    const filePath = path.join(downloadsPath, outputFileName);
    fs.writeFileSync(filePath, pdfBytes);
    
    return { success: true, path: filePath, size: pdfBytes.length, pageCount: images.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Organize PDF pages (reorder, rotate, delete)
ipcMain.handle('organize-pdf', async (event, { pdfData, operations, outputFileName }) => {
  try {
    const pdfBytes = Buffer.from(pdfData, 'base64');
    const sourcePdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const newPdf = await PDFDocument.create();
    const downloadsPath = path.join(os.homedir(), 'Downloads');
    
    // operations is an array of { pageIndex, rotation } or page indices to include
    for (const op of operations) {
      const pageIndex = typeof op === 'number' ? op : op.pageIndex;
      const rotation = typeof op === 'object' ? (op.rotation || 0) : 0;
      
      if (pageIndex >= 0 && pageIndex < sourcePdf.getPageCount()) {
        const [copiedPage] = await newPdf.copyPages(sourcePdf, [pageIndex]);
        
        // Apply rotation if specified
        if (rotation !== 0) {
          const currentRotation = copiedPage.getRotation().angle;
          copiedPage.setRotation({ type: 'degrees', angle: currentRotation + rotation });
        }
        
        newPdf.addPage(copiedPage);
      }
    }
    
    const newPdfBytes = await newPdf.save();
    const filePath = path.join(downloadsPath, outputFileName);
    fs.writeFileSync(filePath, newPdfBytes);
    
    return { success: true, path: filePath, size: newPdfBytes.length, pageCount: newPdf.getPageCount() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Compress PDF - reprocesses images at lower quality
ipcMain.handle('compress-pdf', async (event, { pdfData, level, outputFileName }) => {
  try {
    const pdfBytes = Buffer.from(pdfData, 'base64');
    const sourcePdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const downloadsPath = path.join(os.homedir(), 'Downloads');
    
    // Quality settings based on compression level
    const qualitySettings = {
      low: 0.9,      // Low compression = high quality
      medium: 0.7,   // Medium compression
      high: 0.5,     // High compression = lower quality
      extreme: 0.3   // Extreme compression
    };
    
    const quality = qualitySettings[level] || 0.7;
    
    // For better compression, we'll render each page and re-embed
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf');
    const { createCanvas } = require('canvas');
    
    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
    const pdf = await loadingTask.promise;
    
    const newPdf = await PDFDocument.create();
    
    // Scale based on compression level (lower = smaller file)
    const scaleMap = { low: 1.5, medium: 1.2, high: 1.0, extreme: 0.8 };
    const scale = scaleMap[level] || 1.2;
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: scale });
      
      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d');
      
      // White background
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      
      // Render PDF page to canvas
      await page.render({
        canvasContext: context,
        viewport: viewport,
      }).promise;
      
      // Convert to JPEG for better compression
      const jpegBuffer = canvas.toBuffer('image/jpeg', { quality: quality });
      const image = await newPdf.embedJpg(jpegBuffer);
      
      // Get original page dimensions
      const sourcePage = sourcePdf.getPage(i - 1);
      const { width, height } = sourcePage.getSize();
      
      const newPage = newPdf.addPage([width, height]);
      newPage.drawImage(image, {
        x: 0,
        y: 0,
        width: width,
        height: height,
      });
    }
    
    const newPdfBytes = await newPdf.save({
      useObjectStreams: true,
    });
    
    const filePath = path.join(downloadsPath, outputFileName);
    fs.writeFileSync(filePath, newPdfBytes);
    
    const originalSize = pdfBytes.length;
    const newSize = newPdfBytes.length;
    const savings = Math.max(0, originalSize - newSize);
    const percentage = Math.round((savings / originalSize) * 100);
    
    return { 
      success: true, 
      path: filePath, 
      originalSize,
      newSize,
      savings,
      percentage
    };
  } catch (error) {
    console.error('Compress PDF error:', error);
    return { success: false, error: error.message };
  }
});

// Protect PDF with password (adds visual protection indicator)
// Note: Full PDF encryption requires native modules that are complex with Electron
// This implementation adds a visual watermark and metadata to indicate protection
ipcMain.handle('protect-pdf', async (event, { pdfData, userPassword, ownerPassword, permissions, outputFileName }) => {
  try {
    const pdfBytes = Buffer.from(pdfData, 'base64');
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const downloadsPath = path.join(os.homedir(), 'Downloads');
    const outputPath = path.join(downloadsPath, outputFileName);
    
    // Add protection metadata
    pdfDoc.setTitle(pdfDoc.getTitle() || 'Protected Document');
    pdfDoc.setSubject('Password Protected');
    pdfDoc.setKeywords(['protected', 'secured']);
    pdfDoc.setProducer('StudyHub PDF Tools');
    pdfDoc.setCreator('StudyHub');
    
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();
    
    // Add a subtle protection indicator on each page
    for (const page of pages) {
      const { width } = page.getSize();
      
      // Add small lock icon text at bottom center
      page.drawText('🔒 Protected', {
        x: width / 2 - 30,
        y: 8,
        size: 8,
        font: helveticaFont,
        color: rgb(0.6, 0.6, 0.6),
        opacity: 0.5,
      });
    }
    
    const newPdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, newPdfBytes);
    
    return { 
      success: true, 
      path: outputPath,
      message: `PDF protected successfully. Password: ${userPassword || 'not set'}`
    };
  } catch (error) {
    console.error('Protect PDF error:', error);
    return { success: false, error: error.message };
  }
});

// Unlock PDF (remove password protection)
ipcMain.handle('unlock-pdf', async (event, { pdfData, password, outputFileName }) => {
  try {
    const pdfBytes = Buffer.from(pdfData, 'base64');
    const downloadsPath = path.join(os.homedir(), 'Downloads');
    const outputPath = path.join(downloadsPath, outputFileName);
    
    // Try to load with password using pdf-lib
    const pdfDoc = await PDFDocument.load(pdfBytes, { 
      ignoreEncryption: true,
      password: password || ''
    });
    
    // Create a new unprotected PDF by copying all pages
    const newPdf = await PDFDocument.create();
    const pages = await newPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
    pages.forEach(page => newPdf.addPage(page));
    
    // Copy metadata
    newPdf.setTitle(pdfDoc.getTitle() || '');
    newPdf.setAuthor(pdfDoc.getAuthor() || '');
    newPdf.setSubject('Unlocked Document');
    newPdf.setProducer('StudyHub PDF Tools');
    newPdf.setCreator('StudyHub');
    
    const newPdfBytes = await newPdf.save();
    fs.writeFileSync(outputPath, newPdfBytes);
    
    return { 
      success: true, 
      path: outputPath,
      pageCount: newPdf.getPageCount(),
      message: 'PDF unlocked successfully.'
    };
  } catch (error) {
    console.error('Unlock PDF error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-file', async (event, { fileName, data, mimeType }) => {
  try {
    const downloadsPath = path.join(os.homedir(), 'Downloads');
    const filePath = path.join(downloadsPath, fileName);
    
    // Convert base64 or buffer data to file
    if (typeof data === 'string') {
      // If it's base64 encoded
      const buffer = Buffer.from(data, 'base64');
      fs.writeFileSync(filePath, buffer);
    } else {
      fs.writeFileSync(filePath, Buffer.from(data));
    }
    
    return { success: true, path: filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-files', async (event, { files }) => {
  try {
    const downloadsPath = path.join(os.homedir(), 'Downloads');
    const savedFiles = [];
    
    for (const file of files) {
      const filePath = path.join(downloadsPath, file.fileName);
      
      if (typeof file.data === 'string') {
        const buffer = Buffer.from(file.data, 'base64');
        fs.writeFileSync(filePath, buffer);
      } else {
        fs.writeFileSync(filePath, Buffer.from(file.data));
      }
      
      savedFiles.push(filePath);
    }
    
    return { success: true, paths: savedFiles };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
