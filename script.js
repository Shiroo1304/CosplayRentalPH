// ========== IMPORTS ==========
import { auth, db } from './firebase-config.js';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  sendEmailVerification 
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import {
  collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// ========== GLOBAL STATE ==========
let currentUser = null;
let carouselInterval = null;
let allCosplays = [];
let cosplaysUnsubscribe = null;
let rentalsUnsubscribe = null;
let editingCosplayId = null;

// ========== HELPER FUNCTIONS ==========
function getCurrentUser() { return JSON.parse(localStorage.getItem('currentUser')); }
function saveCurrentUser(user) { localStorage.setItem('currentUser', JSON.stringify(user)); }

function showToast(message) {
  const existingToast = document.querySelector('.toast-notification');
  if (existingToast) existingToast.remove();
  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.innerHTML = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function showLoading(show = true) {
  let overlay = document.querySelector('.loading-overlay');
  if (show) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'loading-overlay';
      overlay.innerHTML = `<div class="loading-spinner"></div><p>Loading...</p>`;
      document.body.appendChild(overlay);
    } else {
      overlay.style.display = 'flex';
    }
    setTimeout(() => {
      const currentOverlay = document.querySelector('.loading-overlay');
      if (currentOverlay && currentOverlay.style.display === 'flex') currentOverlay.remove();
    }, 10000);
  } else {
    if (overlay) overlay.remove();
  }
}

function processSquareImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.includes('jpeg') && !file.type.includes('jpg')) {
      reject(new Error('Only JPG images are allowed'));
      return;
    }
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
      img.onload = () => {
        if (Math.abs(img.width / img.height - 1) > 0.05) {
          reject(new Error('Image must be square (width = height)'));
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 400;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 400, 400);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => reject(new Error('Invalid image file'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('File read error'));
    reader.readAsDataURL(file);
  });
}

// ========== AUTH ==========
async function login(email, password) {
  showLoading(true);
  try {
    const userCred = await signInWithEmailAndPassword(auth, email, password);
    if (!userCred.user.emailVerified) {
      await signOut(auth);
      showToast('Please verify your email first. Check your inbox.');
      showLoading(false);
      return { success: false };
    }
    const userDoc = await getDoc(doc(db, 'users', userCred.user.uid));
    const userData = userDoc.data();
    if (!userData) {
      await signOut(auth);
      showToast('User account not found.');
      showLoading(false);
      return { success: false };
    }
    if (userData.role === 'owner' && !userData.approved) {
      await signOut(auth);
      showToast('Account pending admin approval');
      showLoading(false);
      return { success: false };
    }
    currentUser = { uid: userCred.user.uid, ...userData };
    saveCurrentUser(currentUser);
    showToast(`Welcome back, ${userData.name}!`);
    showLoading(false);
    return { success: true, user: userData };
  } catch (error) {
    showLoading(false);
    showToast(error.message);
    return { success: false };
  }
}

async function signup(name, email, password, role, ownerInfo, verificationDocBase64 = null) {
  showLoading(true);
  try {
    const q = query(collection(db, 'users'), where('email', '==', email));
    const existing = await getDocs(q);
    if (!existing.empty) throw new Error('Email already registered');
    const userCred = await createUserWithEmailAndPassword(auth, email, password);
    await sendEmailVerification(userCred.user);
    const userData = {
      uid: userCred.user.uid,
      name,
      email,
      role,
      approved: role === 'user',
      verified: false,
      ownerName: role === 'owner' ? name : null,
      ownerVerification: role === 'owner' ? { ...ownerInfo, verificationDocBase64 } : null,
      subscription: role === 'owner' ? { active: false, expiresAt: null, plan: 'monthly' } : null,
      createdAt: new Date().toISOString()
    };
    await setDoc(doc(db, 'users', userCred.user.uid), userData);
    showLoading(false);
    showToast('Verification email sent! Please check your inbox and verify before logging in.');
    return { success: true };
  } catch (error) {
    showLoading(false);
    showToast(error.message);
    return { success: false };
  }
}

function logout() {
  showLoading(true);
  signOut(auth);
  localStorage.removeItem('currentUser');
  currentUser = null;
  if (carouselInterval) clearInterval(carouselInterval);
  updateNavbarUI();
  setTimeout(() => {
    showLoading(false);
    showToast('Logged out successfully');
    window.location.href = 'index.html';
  }, 300);
}

// ========== COSPLAYS ==========
async function getCosplays() {
  const snapshot = await getDocs(collection(db, 'cosplays'));
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function addCosplay(name, genre, size, price, image, ownerId, ownerName, measurements, tip, availableUntil, discount, saleEnd, imageBase64 = null) {
  await addDoc(collection(db, 'cosplays'), {
    name, genre, size, price: parseInt(price),
    image: imageBase64 || image || '🎭',
    imageBase64: imageBase64 || null,
    ownerId, ownerName,
    createdAt: new Date().toISOString(),
    availableUntil: availableUntil || new Date(Date.now() + 60*24*60*60*1000).toISOString(),
    discount: discount || 0,
    saleEnd: saleEnd || null,
    measurements: measurements || null,
    tip: tip || '',
    clicks: 0
  });
}

async function updateCosplay(cosplayId, data) { await updateDoc(doc(db, 'cosplays', cosplayId), data); }

async function deleteCosplay(cosplayId, ownerId) {
  const user = getCurrentUser();
  const cosplayRef = doc(db, 'cosplays', cosplayId);
  const cosplaySnap = await getDoc(cosplayRef);
  if (cosplaySnap.exists() && (cosplaySnap.data().ownerId === ownerId || user?.role === 'admin')) {
    await deleteDoc(cosplayRef);
    showToast('Costume deleted');
    return true;
  }
  return false;
}

// ========== RENTALS ==========
async function getRentals() {
  const snapshot = await getDocs(collection(db, 'rentals'));
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}
async function requestRental(cosplayId, renterId, renterName, ownerId, startDate, endDate, totalAmount, deposit, renterVerification, downpayment) {
  await addDoc(collection(db, 'rentals'), {
    cosplayId, renterId, renterName, ownerId, startDate, endDate,
    totalAmount, deposit, downpayment, status: 'paid',
    createdAt: new Date().toISOString(),
    renterVerification: renterVerification || {}
  });
}
async function updateRentalStatus(rentalId, status) { await updateDoc(doc(db, 'rentals', rentalId), { status }); }

// ========== WISHLIST IDEAS ==========
async function getWishlistIdeas() {
  const snapshot = await getDocs(collection(db, 'wishlistIdeas'));
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}
async function addWishlistIdea(name, description, suggestedBy) {
  await addDoc(collection(db, 'wishlistIdeas'), { name, description, suggestedBy, upvotes: 0, createdAt: new Date().toISOString() });
}
async function upvoteIdea(ideaId) {
  const ideaRef = doc(db, 'wishlistIdeas', ideaId);
  const ideaSnap = await getDoc(ideaRef);
  if (ideaSnap.exists()) await updateDoc(ideaRef, { upvotes: (ideaSnap.data().upvotes || 0) + 1 });
}

// ========== DISPLAY COSPLAYS ==========
function displayCosplays(list, containerId, showDelete = false, ownerId = null) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!list.length) { container.innerHTML = '<div class="empty-state">No costumes found 😢</div>'; return; }
  const currentUserObj = getCurrentUser();
  const wishlist = currentUserObj ? JSON.parse(localStorage.getItem(`wishlist_${currentUserObj.uid}`) || '[]') : [];
  container.innerHTML = list.map(c => {
    const isNew = (new Date() - new Date(c.createdAt)) < 7*24*60*60*1000;
    const isLastChance = c.availableUntil && new Date(c.availableUntil) < new Date(Date.now() + 7*24*60*60*1000);
    const isOnSale = c.discount > 0 && (!c.saleEnd || new Date(c.saleEnd) > new Date());
    const finalPrice = isOnSale ? c.price * (1 - c.discount/100) : c.price;
    const inWishlist = wishlist.includes(c.id);
    let imageHtml;
    if (c.imageBase64 && c.imageBase64.startsWith('data:image')) {
      imageHtml = `<img src="${c.imageBase64}" alt="${c.name}" style="width:100%;height:100%;object-fit:cover;">`;
    } else if (c.image && (c.image.startsWith('http') || c.image.startsWith('/'))) {
      imageHtml = `<img src="${c.image}" alt="${c.name}" style="width:100%;height:100%;object-fit:cover;">`;
    } else {
      imageHtml = `<span style="font-size:4rem;">${c.image || '🎭'}</span>`;
    }
    return `
      <div class="cosplay-card">
        ${isNew ? '<div class="badge-new">✨ NEW</div>' : ''}
        ${isLastChance ? '<div class="badge-lastchance">⏳ Last Chance</div>' : ''}
        ${isOnSale ? `<div class="badge-sale">🔥 ${c.discount}% OFF</div>` : ''}
        ${showDelete ? `<button class="delete-cosplay-btn" data-id="${c.id}"><i class="fas fa-trash"></i></button>` : ''}
        <div class="cosplay-image">${imageHtml}</div>
        <div class="cosplay-info">
          <div class="cosplay-name">${c.name}</div>
          <div class="cosplay-owner" data-ownerid="${c.ownerId}" data-ownername="${c.ownerName}"><i class="fas fa-user"></i> ${c.ownerName}</div>
          <div class="cosplay-price">${isOnSale ? `<span class="old-price">₱${c.price}</span> ₱${finalPrice}/day` : `₱${c.price}/day`}</div>
          ${!showDelete ? `<div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap;"><a href="product-detail.html?id=${c.id}" class="btn-primary rent-btn"><i class="fas fa-calendar-alt"></i> Rent</a><button class="wishlist-btn" data-id="${c.id}">${inWishlist ? '❤️' : '🤍'}</button><button class="sizechart-btn" data-id="${c.id}" title="View size chart"><i class="fas fa-ruler"></i></button></div>` : ''}
        </div>
      </div>
    `;
  }).join('');
  document.querySelectorAll('.wishlist-btn').forEach(btn => btn.addEventListener('click', () => {
    if (!currentUserObj) { showToast('Please login first'); return; }
    let w = JSON.parse(localStorage.getItem(`wishlist_${currentUserObj.uid}`) || '[]');
    if (w.includes(btn.dataset.id)) w = w.filter(id => id !== btn.dataset.id);
    else w.push(btn.dataset.id);
    localStorage.setItem(`wishlist_${currentUserObj.uid}`, JSON.stringify(w));
    btn.innerHTML = w.includes(btn.dataset.id) ? '❤️' : '🤍';
  }));
  document.querySelectorAll('.sizechart-btn').forEach(btn => btn.addEventListener('click', () => {
    const cosplay = list.find(c => c.id === btn.dataset.id);
    if (cosplay?.measurements) showSizeChartModal(cosplay);
    else showToast('No size details available for this costume.');
  }));
  document.querySelectorAll('.delete-cosplay-btn').forEach(btn => btn.addEventListener('click', async () => {
    if (confirm('Delete this cosplay?')) { await deleteCosplay(btn.dataset.id, ownerId); location.reload(); }
  }));
  document.querySelectorAll('.cosplay-owner').forEach(el => el.addEventListener('click', () => viewOwnerProfile(el.dataset.ownerid, el.dataset.ownername)));
}

function showSizeChartModal(cosplay) {
  const modal = document.createElement('div');
  modal.className = 'sizechart-modal';
  modal.innerHTML = `
    <div class="sizechart-container">
      <h3>📏 ${cosplay.name} - Size Chart</h3>
      <div class="size-row"><span class="size-label">Bust:</span> <span>${cosplay.measurements.bust || 'N/A'}</span></div>
      <div class="size-row"><span class="size-label">Waist:</span> <span>${cosplay.measurements.waist || 'N/A'}</span></div>
      <div class="size-row"><span class="size-label">Hips:</span> <span>${cosplay.measurements.hips || 'N/A'}</span></div>
      <div class="size-row"><span class="size-label">Length:</span> <span>${cosplay.measurements.length || 'N/A'}</span></div>
      ${cosplay.tip ? `<div class="size-tip">💡 Owner Tip: ${cosplay.tip}</div>` : ''}
      <button class="btn-primary" style="margin-top:15px; width:100%;" onclick="this.closest('.sizechart-modal').remove()">Close</button>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

function viewOwnerProfile(ownerId, ownerName) { showToast(`Owner: ${ownerName} – Contact via chat coming soon.`); }

// ========== DASHBOARD LOADERS ==========
async function loadBrowsePage() {
  showLoading(true);
  let cosplays = await getCosplays();
  const genre = document.getElementById('genreFilter')?.value || 'all';
  const size = document.getElementById('sizeFilter')?.value || 'all';
  const owner = document.getElementById('ownerFilter')?.value || 'all';
  const wishlistFilter = document.getElementById('wishlistFilter')?.value || 'all';
  let filtered = [...cosplays];
  if (genre !== 'all') filtered = filtered.filter(c => c.genre === genre);
  if (size !== 'all') filtered = filtered.filter(c => c.size === size);
  if (owner !== 'all') filtered = filtered.filter(c => c.ownerName === owner);
  if (wishlistFilter === 'wishlist' && currentUser) {
    const wishlistIds = JSON.parse(localStorage.getItem(`wishlist_${currentUser.uid}`) || '[]');
    filtered = filtered.filter(c => wishlistIds.includes(c.id));
  }
  document.getElementById('countNum').innerText = filtered.length;
  displayCosplays(filtered, 'browseGrid', false);
  showLoading(false);
}

async function loadUserDashboard() {
  showLoading(true);
  try {
    const user = getCurrentUser();
    if (!user) {
      showToast('Please login to view dashboard');
      showLoading(false);
      return;
    }
    const cosplays = await getCosplays();
    document.getElementById('welcomeName').innerText = user.name;
    displayCosplays(cosplays.slice(0, 6), 'trendingGrid', false);
    const wishlistIds = JSON.parse(localStorage.getItem(`wishlist_${user.uid}`) || '[]');
    displayCosplays(cosplays.filter(c => wishlistIds.includes(c.id)), 'wishlistGrid', false);
    const rentals = await getRentals();
    const userRentals = rentals.filter(r => r.renterId === user.uid && r.status !== 'completed');
    const rentalsContainer = document.getElementById('userRentalsList');
    if (rentalsContainer) {
      if (!userRentals.length) rentalsContainer.innerHTML = '<div class="empty-state">No active rentals.</div>';
      else {
        rentalsContainer.innerHTML = userRentals.map(r => {
          const c = cosplays.find(c => c.id === r.cosplayId);
          return `<div class="rental-request-card"><div class="rental-info"><h4>${c?.name || 'Unknown'}</h4><p>📅 ${r.startDate} to ${r.endDate}</p><p>💰 ₱${r.totalAmount}</p><p><span class="status-badge status-${r.status}">${r.status.toUpperCase()}</span></p></div></div>`;
        }).join('');
      }
    }
    const randomBtn = document.getElementById('randomizerBtn');
    if (randomBtn) randomBtn.onclick = () => {
      if (!cosplays.length) { showToast('No cosplays available'); return; }
      const random = cosplays[Math.floor(Math.random() * cosplays.length)];
      showToast(`Try ${random.name} by ${random.ownerName} – ₱${random.price}/day`);
    };
    if (typeof initCarousel === 'function' && !carouselInterval) {
      initCarousel();
    }
  } catch (error) {
    console.error('User dashboard error:', error);
    showToast('Failed to load dashboard');
  } finally {
    showLoading(false);
  }
}

async function loadOwnerDashboard() {
  showLoading(true);
  const user = getCurrentUser();
  if (!user || user.role !== 'owner') { showLoading(false); return; }
  
  // Subscription check
  if (user.subscription && !user.subscription.active) {
    const banner = document.createElement('div');
    banner.className = 'subscription-banner';
    banner.innerHTML = `<div class="alert alert-warning" style="background:rgba(255,0,102,0.2); padding:15px; border-radius:12px; margin-bottom:20px;">Your subscription has expired. Please subscribe to continue listing costumes.<button id="subscribeNowBtn" class="btn-primary btn-small" style="margin-left:10px;">Subscribe Now (PayMongo)</button></div>`;
    const dashboardContainer = document.querySelector('.owner-dashboard-new');
    if (dashboardContainer && !document.querySelector('.subscription-banner')) {
      dashboardContainer.prepend(banner);
      document.getElementById('subscribeNowBtn').onclick = async () => {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `<div class="modal-content"><h3>Subscribe via PayMongo</h3><p>Monthly subscription: ₱299/month</p><button id="confirmSubscribe" class="btn-primary">Pay Now</button><button id="cancelSubscribe" class="btn-outline">Cancel</button></div>`;
        document.body.appendChild(modal);
        document.getElementById('confirmSubscribe').onclick = async () => {
          await updateDoc(doc(db, 'users', user.uid), { subscription: { active: true, expiresAt: new Date(Date.now() + 30*24*60*60*1000).toISOString(), plan: 'monthly' } });
          showToast('Subscription activated!');
          modal.remove();
          location.reload();
        };
        document.getElementById('cancelSubscribe').onclick = () => modal.remove();
      };
    }
  }
  
  const allCosplays = await getCosplays();
  const myCosplays = allCosplays.filter(c => c.ownerId === user.uid);
  displayCosplays(myCosplays, 'ownerInventoryGrid', true, user.uid);
  document.getElementById('totalCosplays').innerText = myCosplays.length;
  const rentals = await getRentals();
  const paidRequests = rentals.filter(r => r.ownerId === user.uid && r.status === 'paid');
  const activeRentals = rentals.filter(r => r.ownerId === user.uid && r.status === 'approved');
  document.getElementById('pendingRequests').innerText = paidRequests.length;
  document.getElementById('activeRentals').innerText = activeRentals.length;
  const completed = rentals.filter(r => r.ownerId === user.uid && (r.status === 'completed' || r.status === 'returned'));
  const totalEarnings = completed.reduce((sum, r) => sum + (r.totalAmount || 0), 0);
  document.getElementById('totalEarnings').innerText = `₱${totalEarnings}`;
  document.getElementById('requestCount').innerText = `${paidRequests.length} pending`;
  const requestsContainer = document.getElementById('rentalRequestsList');
  if (requestsContainer) {
    if (!paidRequests.length) requestsContainer.innerHTML = '<div class="empty-state">No pending requests.</div>';
    else {
      requestsContainer.innerHTML = paidRequests.map(r => {
        const c = myCosplays.find(c => c.id === r.cosplayId);
        return `<div class="rental-request-card"><div><h4>${r.renterName} wants ${c?.name}</h4><p>${r.startDate} to ${r.endDate} | Total ₱${r.totalAmount}</p><p><strong>Downpayment:</strong> ₱${r.downpayment} | <strong>Deposit:</strong> ₱${r.deposit}</p></div><div><button class="approve-btn" data-id="${r.id}">Confirm Pickup</button><button class="reject-btn" data-id="${r.id}">Decline</button></div></div>`;
      }).join('');
      document.querySelectorAll('.approve-btn').forEach(btn => btn.addEventListener('click', async () => { await updateRentalStatus(btn.dataset.id, 'approved'); showToast('Rental confirmed'); location.reload(); }));
      document.querySelectorAll('.reject-btn').forEach(btn => btn.addEventListener('click', async () => { await updateRentalStatus(btn.dataset.id, 'rejected'); showToast('Rental declined'); location.reload(); }));
    }
  }
  // Setup modal for adding/editing costumes
  const modal = document.getElementById('costumeModal');
  const addBtn = document.getElementById('addCosplayBtn');
  const closeModalBtn = document.getElementById('closeCostumeModalBtn');
  const cancelBtn = document.getElementById('cancelCostumeBtn');
  const form = document.getElementById('costumeForm');
  const imageInput = document.getElementById('costumeImageInput');
  const imagePreview = document.getElementById('imagePreview');
  let currentImageBase64 = null;
  
  function resetModal() {
    form.reset();
    imagePreview.innerHTML = '';
    currentImageBase64 = null;
    editingCosplayId = null;
    document.getElementById('costumeModalTitle').innerText = 'Add New Costume';
    document.getElementById('costumeName').value = '';
    document.getElementById('costumeGenre').value = 'anime';
    document.getElementById('costumeSize').value = 'small';
    document.getElementById('costumePrice').value = '';
    document.getElementById('costumeTip').value = '';
    document.getElementById('costumeDiscount').value = '0';
    document.getElementById('costumeSaleEnd').value = '';
    document.getElementById('costumeAvailableUntil').value = '';
    document.getElementById('measureBust').value = '';
    document.getElementById('measureWaist').value = '';
    document.getElementById('measureHips').value = '';
    document.getElementById('measureLength').value = '';
  }
  
  async function openModal(editId = null) {
    resetModal();
    if (editId) {
      const cosplay = myCosplays.find(c => c.id === editId);
      if (cosplay) {
        editingCosplayId = editId;
        document.getElementById('costumeModalTitle').innerText = 'Edit Costume';
        document.getElementById('costumeName').value = cosplay.name;
        document.getElementById('costumeGenre').value = cosplay.genre;
        document.getElementById('costumeSize').value = cosplay.size;
        document.getElementById('costumePrice').value = cosplay.price;
        document.getElementById('costumeTip').value = cosplay.tip || '';
        document.getElementById('costumeDiscount').value = cosplay.discount || 0;
        if (cosplay.saleEnd) document.getElementById('costumeSaleEnd').value = cosplay.saleEnd.split('T')[0];
        if (cosplay.availableUntil) document.getElementById('costumeAvailableUntil').value = cosplay.availableUntil.split('T')[0];
        if (cosplay.measurements) {
          document.getElementById('measureBust').value = cosplay.measurements.bust || '';
          document.getElementById('measureWaist').value = cosplay.measurements.waist || '';
          document.getElementById('measureHips').value = cosplay.measurements.hips || '';
          document.getElementById('measureLength').value = cosplay.measurements.length || '';
        }
        if (cosplay.imageBase64) {
          imagePreview.innerHTML = `<img src="${cosplay.imageBase64}" style="max-width:100px; border-radius:8px;">`;
          currentImageBase64 = cosplay.imageBase64;
        }
      }
    }
    modal.style.display = 'flex';
  }
  
  if (addBtn) addBtn.onclick = () => openModal();
  if (closeModalBtn) closeModalBtn.onclick = () => modal.style.display = 'none';
  if (cancelBtn) cancelBtn.onclick = () => modal.style.display = 'none';
  if (modal) modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
  
  imageInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const base64 = await processSquareImage(file);
      currentImageBase64 = base64;
      imagePreview.innerHTML = `<img src="${base64}" style="max-width:100px; border-radius:8px;">`;
    } catch (err) {
      showToast(err.message);
      imageInput.value = '';
      imagePreview.innerHTML = '';
      currentImageBase64 = null;
    }
  };
  
  form.onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('costumeName').value.trim();
    const genre = document.getElementById('costumeGenre').value;
    const size = document.getElementById('costumeSize').value;
    const price = parseInt(document.getElementById('costumePrice').value);
    const tip = document.getElementById('costumeTip').value;
    const discount = parseInt(document.getElementById('costumeDiscount').value) || 0;
    const saleEnd = document.getElementById('costumeSaleEnd').value || null;
    const availableUntil = document.getElementById('costumeAvailableUntil').value || null;
    const measurements = {
      bust: document.getElementById('measureBust').value,
      waist: document.getElementById('measureWaist').value,
      hips: document.getElementById('measureHips').value,
      length: document.getElementById('measureLength').value
    };
    if (!name || !price) { showToast('Please fill in required fields'); return; }
    if (editingCosplayId) {
      const updateData = { name, genre, size, price, tip, discount, measurements, availableUntil, saleEnd };
      if (currentImageBase64) updateData.imageBase64 = currentImageBase64;
      await updateCosplay(editingCosplayId, updateData);
      showToast('Costume updated');
    } else {
      await addCosplay(name, genre, size, price, null, user.uid, user.ownerName || user.name, measurements, tip, availableUntil, discount, saleEnd, currentImageBase64);
      showToast('Costume added');
    }
    modal.style.display = 'none';
    location.reload();
  };
  showLoading(false);
}

async function loadAdminDashboard() {
  showLoading(true);
  const usersSnapshot = await getDocs(collection(db, 'users'));
  const users = usersSnapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
  document.getElementById('totalUsers').innerText = users.length;
  const pendingOwners = users.filter(u => u.role === 'owner' && !u.approved);
  document.getElementById('pendingOwnersCount').innerText = pendingOwners.length;
  const pendingContainer = document.getElementById('pendingOwnersList');
  if (pendingContainer) {
    if (!pendingOwners.length) pendingContainer.innerHTML = '<div class="empty-state">No pending owners.</div>';
    else {
      pendingContainer.innerHTML = pendingOwners.map(o => `<div class="pending-item"><div><strong>${o.name}</strong><br>${o.email}</div><div><button class="approve-btn" data-id="${o.uid}">Approve</button><button class="reject-btn" data-id="${o.uid}">Reject</button></div></div>`).join('');
      document.querySelectorAll('.approve-btn').forEach(btn => btn.addEventListener('click', async () => {
        await updateDoc(doc(db, 'users', btn.dataset.id), { approved: true, verified: true });
        showToast('Owner approved');
        location.reload();
      }));
      document.querySelectorAll('.reject-btn').forEach(btn => btn.addEventListener('click', async () => {
        await deleteDoc(doc(db, 'users', btn.dataset.id));
        showToast('Owner rejected');
        location.reload();
      }));
    }
  }
  const allUsersList = document.getElementById('allUsersList');
  if (allUsersList) {
    allUsersList.innerHTML = users.filter(u => u.role !== 'admin').map(u => `<div class="user-row"><div>${u.name} (${u.email}) - ${u.role}</div><button class="delete-user-btn" data-id="${u.uid}">Delete</button></div>`).join('');
    document.querySelectorAll('.delete-user-btn').forEach(btn => btn.addEventListener('click', async () => {
      await deleteDoc(doc(db, 'users', btn.dataset.id));
      showToast('User deleted');
      location.reload();
    }));
  }
  const cosplays = await getCosplays();
  displayCosplays(cosplays, 'adminCosplaysList', true, null);
  document.getElementById('totalCosplaysAdmin').innerText = cosplays.length;
  document.getElementById('adminAddCosplayBtn').onclick = async () => {
    const name = prompt('Name'); const ownerEmail = prompt('Owner email');
    const usersSnap = await getDocs(collection(db, 'users'));
    const owner = usersSnap.docs.find(d => d.data().email === ownerEmail && d.data().role === 'owner' && d.data().approved);
    if (!owner) { showToast('Owner not found'); return; }
    const genre = prompt('Genre'); const size = prompt('Size'); const price = prompt('Price');
    if (name && genre && size && price) addCosplay(name, genre, size, price, '🎭', owner.id, owner.data().ownerName || owner.data().name);
    showToast('Cosplay added');
    location.reload();
  };
  document.getElementById('addUserBtn').onclick = async () => {
    const name = prompt('New user name'); const email = prompt('Email address'); const role = prompt('Role (user/owner)'); const password = prompt('Password');
    if (!name || !email || !role || !password) { showToast('All fields required'); return; }
    try {
      const userCred = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, 'users', userCred.user.uid), { uid: userCred.user.uid, name, email, role, approved: role !== 'owner', verified: role !== 'owner', createdAt: new Date().toISOString() });
      showToast('User added');
      location.reload();
    } catch(e) { showToast(e.message); }
  };
  showLoading(false);
}

async function loadRentalsPage() {
  const user = getCurrentUser();
  if (!user) return;
  showLoading(true);
  const rentals = await getRentals();
  const userRentals = rentals.filter(r => r.renterId === user.uid);
  const cosplays = await getCosplays();
  const container = document.getElementById('rentalsList');
  if (!container) return;
  function renderRentals(status) {
    const filtered = status === 'all' ? userRentals : userRentals.filter(r => r.status === status);
    if (!filtered.length) { container.innerHTML = '<div class="empty-state">No rentals found for that status.</div>'; return; }
    container.innerHTML = filtered.map(r => {
      const c = cosplays.find(c => c.id === r.cosplayId);
      const days = Math.ceil((new Date(r.endDate) - new Date(r.startDate)) / (1000*60*60*24)) + 1;
      const isNearReturn = (new Date(r.endDate) - new Date()) < 2*24*60*60*1000 && r.status === 'approved';
      return `<div class="rental-card" data-status="${r.status}">
        <div class="rental-info">
          <h4>${c?.name || 'Unknown'}</h4>
          <p>${r.startDate} to ${r.endDate} (${days} days)</p>
          <p>Total: ₱${r.totalAmount} | Deposit: ₱${r.deposit}</p>
          <p><span class="status-badge status-${r.status}">${r.status.toUpperCase()}</span> ${isNearReturn ? '<span class="badge-urgent">🔔 Return soon!</span>' : ''}</p>
        </div>
        ${r.status === 'paid' ? '<button class="complete-btn" data-id="'+r.id+'">Mark Completed</button>' : ''}
      </div>`;
    }).join('');
    document.querySelectorAll('.complete-btn').forEach(btn => btn.addEventListener('click', async () => {
      await updateRentalStatus(btn.dataset.id, 'completed');
      showToast('Rental completed! Thank you.');
      location.reload();
    }));
  }
  renderRentals('all');
  const tabs = document.querySelectorAll('.rental-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.classList.contains('active')) return;
      const targetStatus = tab.dataset.status;
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const currentCards = document.querySelectorAll('.rental-card');
      if (currentCards.length) {
        currentCards.forEach(card => card.classList.add('fade-out'));
        setTimeout(() => renderRentals(targetStatus), 200);
      } else { renderRentals(targetStatus); }
    });
  });
  showLoading(false);
}

async function loadWishlistPage() {
  showLoading(true);
  const ideas = await getWishlistIdeas();
  const container = document.getElementById('wishlistIdeas');
  if (!container) return;
  if (!ideas.length) container.innerHTML = '<div class="empty-state">No suggestions yet. Be the first!</div>';
  else {
    container.innerHTML = ideas.map(i => `<div class="cosplay-card"><div class="cosplay-info"><div class="cosplay-name">${i.name}</div><p>${i.description || ''}</p><p>Suggested by: ${i.suggestedBy}</p><button class="upvote-btn" data-id="${i.id}">👍 Upvote (${i.upvotes})</button></div></div>`).join('');
    document.querySelectorAll('.upvote-btn').forEach(btn => btn.addEventListener('click', async () => {
      await upvoteIdea(btn.dataset.id);
      showToast('Voted!');
      loadWishlistPage();
    }));
  }
  document.getElementById('suggestBtn').onclick = () => document.getElementById('suggestModal').style.display = 'flex';
  document.getElementById('closeSuggestModal').onclick = () => document.getElementById('suggestModal').style.display = 'none';
  document.getElementById('submitSuggestion').onclick = async () => {
    const name = document.getElementById('suggestName')?.value;
    const desc = document.getElementById('suggestDesc')?.value;
    if (!name) { showToast('Please enter a costume name'); return; }
    await addWishlistIdea(name, desc, currentUser?.name || 'Anonymous');
    showToast('Suggestion added!');
    document.getElementById('suggestModal').style.display = 'none';
    loadWishlistPage();
  };
  showLoading(false);
}

async function loadProductDetail() {
  showLoading(true);
  const urlParams = new URLSearchParams(window.location.search);
  const cosplayId = urlParams.get('id');
  if (!cosplayId) { document.getElementById('productContainer').innerHTML = '<div class="empty-state">No costume selected.</div>'; showLoading(false); return; }
  const cosplays = await getCosplays();
  const cosplay = cosplays.find(c => c.id === cosplayId);
  if (!cosplay) { document.getElementById('productContainer').innerHTML = '<div class="empty-state">Costume not found.</div>'; showLoading(false); return; }
  
  // Increment click count
  const cosplayRef = doc(db, 'cosplays', cosplayId);
  await updateDoc(cosplayRef, { clicks: (cosplay.clicks || 0) + 1 });
  
  const currentUserObj = getCurrentUser();
  const wishlist = currentUserObj ? JSON.parse(localStorage.getItem(`wishlist_${currentUserObj.uid}`) || '[]') : [];
  const inWishlist = wishlist.includes(cosplay.id);
  const isNew = (new Date() - new Date(cosplay.createdAt)) < 7*24*60*60*1000;
  const isLastChance = cosplay.availableUntil && new Date(cosplay.availableUntil) < new Date(Date.now() + 7*24*60*60*1000);
  const isOnSale = cosplay.discount > 0 && (!cosplay.saleEnd || new Date(cosplay.saleEnd) > new Date());
  const finalPrice = isOnSale ? cosplay.price * (1 - cosplay.discount/100) : cosplay.price;
  let imageHtml;
  if (cosplay.imageBase64 && cosplay.imageBase64.startsWith('data:image')) {
    imageHtml = `<img src="${cosplay.imageBase64}" alt="${cosplay.name}">`;
  } else if (cosplay.image && (cosplay.image.startsWith('http') || cosplay.image.startsWith('/'))) {
    imageHtml = `<img src="${cosplay.image}" alt="${cosplay.name}">`;
  } else {
    imageHtml = `<span style="font-size: 6rem;">${cosplay.image || '🎭'}</span>`;
  }
  document.getElementById('productImage').innerHTML = imageHtml;
  document.getElementById('productName').innerText = cosplay.name;
  document.getElementById('productOwner').innerHTML = `<i class="fas fa-user"></i> Owner: ${cosplay.ownerName}`;
  let priceHtml = isOnSale ? `<span class="old-price">₱${cosplay.price}</span> ₱${finalPrice}/day` : `₱${finalPrice}/day`;
  if (isOnSale) priceHtml += `<span class="discount-badge">${cosplay.discount}% OFF</span>`;
  document.getElementById('productPrice').innerHTML = priceHtml;
  let badgesHtml = '';
  if (isNew) badgesHtml += '<span class="badge-new">✨ NEW</span>';
  if (isLastChance) badgesHtml += '<span class="badge-lastchance">⏳ Last Chance</span>';
  if (isOnSale) badgesHtml += `<span class="badge-sale">🔥 ${cosplay.discount}% OFF</span>`;
  document.getElementById('productBadges').innerHTML = badgesHtml;
  const sizeSelect = document.getElementById('sizeSelect');
  sizeSelect.innerHTML = '';
  if (cosplay.measurements && cosplay.measurements.availableSizes) {
    cosplay.measurements.availableSizes.forEach(sz => { const opt = document.createElement('option'); opt.value = sz; opt.textContent = sz; sizeSelect.appendChild(opt); });
  } else {
    const defaultSizes = cosplay.size === 'small' ? ['S', 'M'] : ['L', 'XL'];
    defaultSizes.forEach(sz => { const opt = document.createElement('option'); opt.value = sz; opt.textContent = sz; sizeSelect.appendChild(opt); });
  }
  document.getElementById('sizeGuideLink').onclick = () => {
    const modal = document.getElementById('sizeChartModal');
    const content = document.getElementById('sizeChartContent');
    if (cosplay.measurements) {
      content.innerHTML = `<div class="size-row"><span class="size-label">Bust:</span> <span>${cosplay.measurements.bust || 'N/A'}</span></div>
        <div class="size-row"><span class="size-label">Waist:</span> <span>${cosplay.measurements.waist || 'N/A'}</span></div>
        <div class="size-row"><span class="size-label">Hips:</span> <span>${cosplay.measurements.hips || 'N/A'}</span></div>
        <div class="size-row"><span class="size-label">Length:</span> <span>${cosplay.measurements.length || 'N/A'}</span></div>
        ${cosplay.tip ? `<div class="size-tip">💡 Owner Tip: ${cosplay.tip}</div>` : ''}`;
    } else content.innerHTML = '<p>No size details available.</p>';
    modal.style.display = 'flex';
  };
  document.getElementById('closeSizeChart').onclick = () => document.getElementById('sizeChartModal').style.display = 'none';
  const startInput = document.getElementById('startDate');
  const endInput = document.getElementById('endDate');
  const totalDisplay = document.getElementById('totalDisplay');
  function updateTotal() {
    if (startInput.value && endInput.value) {
      const start = new Date(startInput.value);
      const end = new Date(endInput.value);
      if (end >= start) {
        const days = Math.ceil((end - start) / (1000*60*60*24)) + 1;
        const total = days * finalPrice;
        const deposit = Math.ceil(total * 0.5);
        const downpayment = Math.ceil(total * 0.2);
        totalDisplay.innerHTML = `<strong>Total: ₱${total}</strong> (${days} days)<br><span class="price-breakdown">⬇️ Downpayment (20%): ₱${downpayment} | 🔒 Deposit (50%): ₱${deposit}</span>`;
      } else totalDisplay.innerHTML = '<span style="color:#ff6666">End date must be after start date</span>';
    } else totalDisplay.innerHTML = '';
  }
  startInput.addEventListener('change', updateTotal);
  endInput.addEventListener('change', updateTotal);
  document.getElementById('rentNowBtn').onclick = async () => {
    if (!currentUserObj) { showToast('Please login first'); return; }
    if (!startInput.value || !endInput.value) { showToast('Select rental dates'); return; }
    const start = new Date(startInput.value);
    const end = new Date(endInput.value);
    if (end < start) { showToast('End date must be after start date'); return; }
    const days = Math.ceil((end - start) / (1000*60*60*24)) + 1;
    const total = days * finalPrice;
    const deposit = Math.ceil(total * 0.5);
    const downpayment = Math.ceil(total * 0.2);
    
    // Simulate PayMongo payment
    const payKey = localStorage.getItem('paymongo_key');
    if (!payKey) {
      showToast('Please set your PayMongo API key in Payment Settings');
      return;
    }
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `<div class="modal-content"><h3>PayMongo Checkout</h3><p>Amount: ₱${total}</p><p>This is a simulation. In production, you would redirect to PayMongo.</p><button id="simulatePaymentBtn" class="btn-primary">Pay Now (Simulate)</button><button id="cancelPaymentBtn" class="btn-outline">Cancel</button></div>`;
    document.body.appendChild(modal);
    document.getElementById('simulatePaymentBtn').onclick = () => {
      requestRental(cosplay.id, currentUserObj.uid, currentUserObj.name, cosplay.ownerId, startInput.value, endInput.value, total, deposit, {}, downpayment);
      showToast('Rental request sent! Check My Rentals page.');
      modal.remove();
      window.location.href = 'rentals.html';
    };
    document.getElementById('cancelPaymentBtn').onclick = () => modal.remove();
  };
  const wishlistBtn = document.getElementById('wishlistBtn');
  if (wishlistBtn) {
    wishlistBtn.innerHTML = inWishlist ? '<i class="fas fa-heart"></i> Remove from Wishlist' : '<i class="fas fa-heart"></i> Add to Wishlist';
    wishlistBtn.onclick = () => {
      if (!currentUserObj) { showToast('Login first'); return; }
      let w = JSON.parse(localStorage.getItem(`wishlist_${currentUserObj.uid}`) || '[]');
      if (w.includes(cosplay.id)) {
        w = w.filter(id => id !== cosplay.id);
        wishlistBtn.innerHTML = '<i class="fas fa-heart"></i> Add to Wishlist';
      } else {
        w.push(cosplay.id);
        wishlistBtn.innerHTML = '<i class="fas fa-heart"></i> Remove from Wishlist';
      }
      localStorage.setItem(`wishlist_${currentUserObj.uid}`, JSON.stringify(w));
      showToast('Wishlist updated');
    };
  }
  if (cosplay.tip && document.getElementById('sizeNotice')) document.getElementById('sizeNotice').innerHTML = cosplay.tip;
  showLoading(false);
}

async function initCarousel() {
  const container = document.getElementById('carouselSlides');
  if (!container) return;
  let carouselCosplays = (await getCosplays()).slice(0, 5);
  carouselCosplays.sort((a,b) => (b.clicks || 0) - (a.clicks || 0));
  carouselCosplays = carouselCosplays.slice(0,5);
  if (!carouselCosplays.length) { container.innerHTML = '<div class="empty-state">No featured costumes</div>'; return; }
  const isHomepage = window.location.pathname === '/' || window.location.pathname.endsWith('index.html');
  container.innerHTML = carouselCosplays.map((c, idx) => {
    let imageHtml;
    if (c.imageBase64 && c.imageBase64.startsWith('data:image')) {
      imageHtml = `<img src="${c.imageBase64}" alt="${c.name}">`;
    } else if (c.image && (c.image.startsWith('http') || c.image.startsWith('/'))) {
      imageHtml = `<img src="${c.image}" alt="${c.name}">`;
    } else {
      imageHtml = `<div style="display:flex; align-items:center; justify-content:center; height:100%; background:linear-gradient(135deg,#ff0066,#9900ff);"><span style="font-size:8rem;">${c.image || '🎭'}</span></div>`;
    }
    if (isHomepage) return `<div class="carousel-slide" data-index="${idx}">${imageHtml}</div>`;
    return `<div class="carousel-slide" data-index="${idx}">${imageHtml}<div class="carousel-slide-content"><h3>${c.name}</h3><p>by ${c.ownerName} • ₱${c.price}/day</p><a href="product-detail.html?id=${c.id}" class="btn-primary btn-small">Rent Now</a></div></div>`;
  }).join('');
  const dotsContainer = document.getElementById('carouselDots');
  if (dotsContainer) dotsContainer.innerHTML = carouselCosplays.map((_, i) => `<span class="carousel-dot ${i === 0 ? 'active' : ''}" data-index="${i}"></span>`).join('');
  let currentSlide = 0;
  const slidesContainer = document.querySelector('.carousel-slides');
  function goToSlide(index) { currentSlide = index; slidesContainer.style.transform = `translateX(-${currentSlide * 100}%)`; document.querySelectorAll('.carousel-dot').forEach((dot, i) => dot.classList.toggle('active', i === currentSlide)); }
  function changeSlide(direction) { let newIndex = currentSlide + direction; if (newIndex < 0) newIndex = carouselCosplays.length - 1; if (newIndex >= carouselCosplays.length) newIndex = 0; goToSlide(newIndex); }
  let startX = 0, isDragging = false;
  const handleStart = (x) => { startX = x; isDragging = true; if (carouselInterval) clearInterval(carouselInterval); };
  const handleMove = (x) => { if (isDragging && Math.abs(x - startX) > 50) { changeSlide(x - startX > 0 ? -1 : 1); isDragging = false; if (carouselInterval) clearInterval(carouselInterval); carouselInterval = setInterval(() => changeSlide(1), 3000); } };
  const handleEnd = () => { isDragging = false; };
  slidesContainer.addEventListener('touchstart', e => handleStart(e.touches[0].clientX));
  slidesContainer.addEventListener('touchmove', e => handleMove(e.touches[0].clientX));
  slidesContainer.addEventListener('touchend', handleEnd);
  slidesContainer.addEventListener('mousedown', e => handleStart(e.clientX));
  slidesContainer.addEventListener('mousemove', e => handleMove(e.clientX));
  slidesContainer.addEventListener('mouseup', handleEnd);
  document.querySelectorAll('.carousel-dot').forEach(dot => dot.addEventListener('click', (e) => { goToSlide(parseInt(e.target.dataset.index)); if (carouselInterval) clearInterval(carouselInterval); carouselInterval = setInterval(() => changeSlide(1), 3000); }));
  if (carouselInterval) clearInterval(carouselInterval);
  carouselInterval = setInterval(() => changeSlide(1), 3000);
}

async function populateOwnerFilter() {
  const ownerSelect = document.getElementById('ownerFilter');
  if (!ownerSelect) return;
  const cosplays = await getCosplays();
  const owners = [...new Set(cosplays.map(c => c.ownerName).filter(Boolean))];
  ownerSelect.innerHTML = '<option value="all">All Owners</option>' + owners.map(o => `<option value="${o}">${o}</option>`).join('');
}

function updateNavLinks() {
  const navLinksContainer = document.querySelector('.nav-links');
  if (!navLinksContainer) return;
  const user = getCurrentUser();
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  let dashboardLink = '';
  if (user) {
    if (user.role === 'user') dashboardLink = 'user-dashboard.html';
    else if (user.role === 'owner') dashboardLink = 'owner-dashboard.html';
    else if (user.role === 'admin') dashboardLink = 'admin-dashboard.html';
  }
  if (user) {
    navLinksContainer.innerHTML = `
      <li><a href="${dashboardLink}" id="homeLink">Home</a></li>
      <li><a href="browse.html">Browse</a></li>
      <li><a href="rentals.html">My Rentals</a></li>
      <li><a href="wishlist.html">Wishlist</a></li>
    `;
  } else {
    navLinksContainer.innerHTML = '';
  }
  document.querySelectorAll('.nav-links a').forEach(a => {
    if (a.getAttribute('href') === currentPage) a.classList.add('active');
  });
}

function updateNavbarUI() {
  const user = getCurrentUser();
  const profileNameSpan = document.getElementById('profileName');
  const userNameSpan = document.getElementById('userNameDisplay');
  const logoutBtn = document.getElementById('logoutBtn');
  const openAuthBtn = document.getElementById('openAuthBtn');
  const profileDropdown = document.querySelector('.profile-dropdown');
  const navLinksContainer = document.querySelector('.nav-links');
  
  if (user) {
    document.body.classList.add('logged-in');
    if (profileNameSpan) profileNameSpan.innerText = user.name;
    if (userNameSpan) userNameSpan.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (openAuthBtn) openAuthBtn.style.display = 'none';
    if (profileDropdown) profileDropdown.style.display = 'inline-block';
    if (navLinksContainer) navLinksContainer.style.display = 'flex';
  } else {
    document.body.classList.remove('logged-in');
    if (profileNameSpan) profileNameSpan.innerText = '';
    if (userNameSpan) userNameSpan.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (openAuthBtn) openAuthBtn.style.display = 'inline-flex';
    if (profileDropdown) profileDropdown.style.display = 'none';
    if (navLinksContainer) navLinksContainer.style.display = 'none';
  }
  updateNavLinks();
  
  const logoLink = document.querySelector('.logo a');
  if (logoLink) {
    if (user) {
      let dashboard = 'user-dashboard.html';
      if (user.role === 'owner') dashboard = 'owner-dashboard.html';
      if (user.role === 'admin') dashboard = 'admin-dashboard.html';
      logoLink.href = dashboard;
    } else {
      logoLink.href = 'index.html';
    }
  }
}

// Profile dropdown click handling
function initProfileDropdown() {
  const profileTrigger = document.querySelector('.profile-dropdown');
  const dropdownMenu = document.getElementById('profileDropdownMenu');
  if (!profileTrigger || !dropdownMenu) return;
  profileTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownMenu.classList.toggle('show');
  });
  document.addEventListener('click', (e) => {
    if (!profileTrigger.contains(e.target)) {
      dropdownMenu.classList.remove('show');
    }
  });
}

// Account Settings modal
async function showAccountSettingsModal() {
  const user = getCurrentUser();
  if (!user) return;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>Account Settings</h3>
      <div class="form-group"><label>Name</label><input type="text" id="settingsName" value="${user.name.replace(/</g, '&lt;').replace(/>/g, '&gt;')}"></div>
      <div class="form-group"><label>Email</label><input type="email" value="${user.email}" disabled></div>
      <div class="form-group"><label>Address</label><input type="text" id="settingsAddress" value="${user.address || ''}"></div>
      <div class="form-group"><label>Phone</label><input type="tel" id="settingsPhone" value="${user.phone || ''}"></div>
      <div class="form-actions"><button id="saveSettingsBtn" class="btn-primary">Save</button><button id="closeSettingsBtn" class="btn-outline">Cancel</button></div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#closeSettingsBtn').onclick = () => modal.remove();
  modal.querySelector('#saveSettingsBtn').onclick = async () => {
    const updates = {
      name: modal.querySelector('#settingsName').value,
      address: modal.querySelector('#settingsAddress').value,
      phone: modal.querySelector('#settingsPhone').value
    };
    await updateDoc(doc(db, 'users', user.uid), updates);
    user.name = updates.name;
    user.address = updates.address;
    user.phone = updates.phone;
    saveCurrentUser(user);
    showToast('Settings updated');
    modal.remove();
    updateNavbarUI();
  };
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

// Payment Settings (PayMongo)
function showPaymentSettingsModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>Payment Settings (PayMongo)</h3>
      <div class="form-group"><label>PayMongo API Key (test)</label><input type="text" id="paymongoKey" placeholder="pk_test_..."></div>
      <div class="form-group"><label>Bank Account (optional)</label><input type="text" id="bankAccount" placeholder="Account number"></div>
      <div class="form-actions"><button id="savePaymentBtn" class="btn-primary">Save</button><button id="closePaymentBtn" class="btn-outline">Cancel</button></div>
    </div>
  `;
  document.body.appendChild(modal);
  const savedKey = localStorage.getItem('paymongo_key') || '';
  if (savedKey) modal.querySelector('#paymongoKey').value = savedKey;
  modal.querySelector('#closePaymentBtn').onclick = () => modal.remove();
  modal.querySelector('#savePaymentBtn').onclick = () => {
    const key = modal.querySelector('#paymongoKey').value;
    if (key) localStorage.setItem('paymongo_key', key);
    showToast('Payment settings saved (demo)');
    modal.remove();
  };
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

// Light/Dark mode toggle
function initThemeToggle() {
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  if (themeToggleBtn) {
    themeToggleBtn.onclick = () => {
      document.body.classList.toggle('light-mode');
      const isLight = document.body.classList.contains('light-mode');
      localStorage.setItem('cosplay_theme', isLight ? 'light' : 'dark');
      themeToggleBtn.innerHTML = isLight ? '<i class="fas fa-sun"></i> Light Mode' : '<i class="fas fa-moon"></i> Dark Mode';
    };
    const isLight = document.body.classList.contains('light-mode');
    themeToggleBtn.innerHTML = isLight ? '<i class="fas fa-sun"></i> Light Mode' : '<i class="fas fa-moon"></i> Dark Mode';
  }
}

function initRoleModalAndSignup() {
  const authModal = document.getElementById('authModal');
  const openAuthBtn = document.getElementById('openAuthBtn');
  const scrollBtn = document.getElementById('scrollToSignupBtn');
  if (openAuthBtn) openAuthBtn.onclick = () => { authModal.style.display = 'flex'; };
  if (scrollBtn) scrollBtn.onclick = () => document.getElementById('signupCompact')?.scrollIntoView({ behavior: 'smooth' });
  
  // Inline signup form (on homepage)
  const inlineForm = document.getElementById('signupFormInline');
  if (inlineForm) {
    inlineForm.onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById('inlineName').value;
      const email = document.getElementById('inlineEmail').value;
      const password = document.getElementById('inlinePassword').value;
      const role = document.querySelector('.role-selector-btn.active')?.dataset.role === 'owner' ? 'owner' : 'user';
      const ownerInfo = role === 'owner' ? {
        shopName: document.getElementById('inlineShopName')?.value,
        idType: document.getElementById('inlineIdType')?.value,
        idNumber: document.getElementById('inlineIdNumber')?.value,
        address: document.getElementById('inlineAddress')?.value,
        phone: document.getElementById('inlinePhone')?.value
      } : {};
      let verificationDocBase64 = null;
      const docFile = document.getElementById('signupDocFile');
      if (docFile && docFile.files.length) {
        const file = docFile.files[0];
        if (file.type.includes('jpeg') || file.type.includes('jpg')) {
          verificationDocBase64 = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.readAsDataURL(file);
          });
        } else {
          showToast('Please upload a JPG image for verification document.');
          return;
        }
      }
      const result = await signup(name, email, password, role, ownerInfo, verificationDocBase64);
      if (result.success && role !== 'owner') {
        document.getElementById('loginEmail').value = email;
        document.getElementById('loginPassword').value = password;
        document.querySelector('.tab-btn[data-tab="login"]').click();
        authModal.style.display = 'flex';
      }
    };
  }
  document.querySelectorAll('.role-selector-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.role-selector-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('inlineOwnerFields').style.display = btn.dataset.role === 'owner' ? 'block' : 'none';
    };
  });
  
  // Modal signup form (in auth modal)
  const signupForm = document.getElementById('signupForm');
  if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('signupName').value;
      const email = document.getElementById('signupEmail').value;
      const password = document.getElementById('signupPassword').value;
      const role = document.getElementById('signupRole').value;
      const ownerInfo = {
        shopName: document.getElementById('signupShopName')?.value || '',
        idType: document.getElementById('signupIdType')?.value || '',
        idNumber: document.getElementById('signupIdNumber')?.value || '',
        address: document.getElementById('signupAddress')?.value || '',
        phone: document.getElementById('signupPhone')?.value || ''
      };
      let verificationDocBase64 = null;
      const docFile = document.getElementById('signupDocFile');
      if (docFile && docFile.files.length) {
        const file = docFile.files[0];
        if (file.type.includes('jpeg') || file.type.includes('jpg')) {
          verificationDocBase64 = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.readAsDataURL(file);
          });
        } else {
          showToast('Please upload a JPG image for verification document.');
          return;
        }
      }
      const result = await signup(name, email, password, role, ownerInfo, verificationDocBase64);
      if (result.success && role !== 'owner') {
        document.querySelector('.tab-btn[data-tab="login"]').click();
      }
    });
  }
}

// ========== AUTH STATE LISTENER ==========
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (userDoc.exists()) {
      currentUser = { uid: user.uid, ...userDoc.data() };
      saveCurrentUser(currentUser);
    } else {
      await signOut(auth);
      return;
    }
    updateNavbarUI();
    if (cosplaysUnsubscribe) cosplaysUnsubscribe();
    cosplaysUnsubscribe = onSnapshot(collection(db, 'cosplays'), () => {
      const path = window.location.pathname;
      if (path.includes('browse.html')) loadBrowsePage();
      else if (path.includes('user-dashboard.html')) loadUserDashboard();
      else if (path.includes('owner-dashboard.html')) loadOwnerDashboard();
      else if (path.includes('admin-dashboard.html')) loadAdminDashboard();
      else if (path.includes('index.html') || path === '/') {
        getCosplays().then(cosplays => {
          const sorted = [...cosplays].sort((a,b) => (b.clicks || 0) - (a.clicks || 0));
          displayCosplays(sorted.slice(0,4), 'featuredGrid', false);
        });
      }
    });
    if (currentUser.role === 'user') {
      if (rentalsUnsubscribe) rentalsUnsubscribe();
      rentalsUnsubscribe = onSnapshot(query(collection(db, 'rentals'), where('renterId', '==', currentUser.uid)), () => {
        if (window.location.pathname.includes('rentals.html')) loadRentalsPage();
      });
    }
    const page = window.location.pathname.split('/').pop() || 'index.html';
    if (page === 'index.html' || page === '') {
      let redirect = 'user-dashboard.html';
      if (currentUser.role === 'owner') redirect = 'owner-dashboard.html';
      if (currentUser.role === 'admin') redirect = 'admin-dashboard.html';
      window.location.href = redirect;
    }
  } else {
    currentUser = null;
    localStorage.removeItem('currentUser');
    if (cosplaysUnsubscribe) cosplaysUnsubscribe();
    if (rentalsUnsubscribe) rentalsUnsubscribe();
    updateNavbarUI();
    const path = window.location.pathname;
    if (!path.includes('index.html') && !path.includes('about.html') && path !== '/') {
      window.location.href = 'index.html';
    } else {
      cosplaysUnsubscribe = onSnapshot(collection(db, 'cosplays'), () => {
        if (path.includes('index.html') || path === '/') {
          getCosplays().then(cosplays => {
            const sorted = [...cosplays].sort((a,b) => (b.clicks || 0) - (a.clicks || 0));
            displayCosplays(sorted.slice(0,4), 'featuredGrid', false);
          });
        }
      });
    }
  }
});

// ========== MAIN INIT ==========
document.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem('cosplay_theme') === 'light') document.body.classList.add('light-mode');
  
  currentUser = getCurrentUser();
  updateNavbarUI();
  initRoleModalAndSignup();
  initProfileDropdown();
  initThemeToggle();
  
  // Profile dropdown buttons
  const accountSettingsBtn = document.getElementById('accountSettingsBtn');
  if (accountSettingsBtn) accountSettingsBtn.onclick = showAccountSettingsModal;
  const paymentSettingsBtn = document.getElementById('paymentSettingsBtn');
  if (paymentSettingsBtn) paymentSettingsBtn.onclick = showPaymentSettingsModal;
  const dropdownLogoutBtn = document.getElementById('dropdownLogoutBtn');
  if (dropdownLogoutBtn) dropdownLogoutBtn.onclick = () => logout();
  
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);
  
  const page = window.location.pathname.split('/').pop() || 'index.html';
  if (page === 'browse.html') {
    populateOwnerFilter();
    document.getElementById('genreFilter')?.addEventListener('change', loadBrowsePage);
    document.getElementById('sizeFilter')?.addEventListener('change', loadBrowsePage);
    document.getElementById('ownerFilter')?.addEventListener('change', loadBrowsePage);
    document.getElementById('wishlistFilter')?.addEventListener('change', loadBrowsePage);
    document.getElementById('resetFilters')?.addEventListener('click', () => {
      document.getElementById('genreFilter').value = 'all';
      document.getElementById('sizeFilter').value = 'all';
      document.getElementById('ownerFilter').value = 'all';
      document.getElementById('wishlistFilter').value = 'all';
      loadBrowsePage();
    });
    loadBrowsePage();
  }
  if (page === 'user-dashboard.html' && currentUser?.role === 'user') loadUserDashboard();
  if (page === 'owner-dashboard.html' && currentUser?.role === 'owner') loadOwnerDashboard();
  if (page === 'admin-dashboard.html' && currentUser?.role === 'admin') loadAdminDashboard();
  if (page === 'rentals.html') loadRentalsPage();
  if (page === 'wishlist.html') loadWishlistPage();
  if (page === 'product-detail.html') loadProductDetail();
  if (page === 'about.html') {
    document.querySelectorAll('.faq-question').forEach(q => q.addEventListener('click', () => q.parentElement.classList.toggle('active')));
  }
  
  const authModal = document.getElementById('authModal');
  const closeAuth = document.getElementById('closeAuthModalBtn');
  if (closeAuth) closeAuth.onclick = () => authModal.style.display = 'none';
  if (authModal) authModal.addEventListener('click', (e) => { if (e.target === authModal) authModal.style.display = 'none'; });
  
  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(btn.dataset.tab + 'Tab').classList.add('active');
  }));
  
  const signupRole = document.getElementById('signupRole');
  if (signupRole) signupRole.addEventListener('change', () => {
    document.getElementById('ownerSignupFields').style.display = signupRole.value === 'owner' ? 'block' : 'none';
  });
  
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value;
      const password = document.getElementById('loginPassword').value;
      const result = await login(email, password);
      if (result.success) {
        let redirect = 'user-dashboard.html';
        if (result.user.role === 'owner') redirect = 'owner-dashboard.html';
        if (result.user.role === 'admin') redirect = 'admin-dashboard.html';
        window.location.href = redirect;
      }
    });
  }
});

window.addEventListener('beforeunload', () => { if (carouselInterval) clearInterval(carouselInterval); });