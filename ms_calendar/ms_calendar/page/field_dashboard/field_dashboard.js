frappe.pages['field-dashboard'].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Field Recruitment Dashboard',
		single_column: true
	});

	const STATUS_CARDS = [
		{ status: 'New Applicant',            label: 'NEW APPLICANT',             color: '#1F497D' },
		{ status: 'On Hold',                  label: 'ON HOLD',                   color: '#6b7280' },
		{ status: 'Blocklisted',              label: 'BLOCKLISTED',               color: '#dc2626' },
		{ status: 'CV Shortlist',             label: 'CV SHORTLIST',              color: '#1F497D' },
		{ status: 'CV Reject',                label: 'CV REJECT',                 color: '#dc2626' },
		{ status: 'Test Process',             label: 'TEST PROCESS',              color: '#1F497D' },
		{ status: 'Test Select',              label: 'TEST SELECT',               color: '#16a34a' },
		{ status: 'Test Reject',              label: 'TEST REJECT',               color: '#dc2626' },
		{ status: 'Recruiter Round',          label: 'RECRUITER ROUND',           color: '#1F497D' },
		{ status: 'Recruiter Round Select',   label: 'RECRUITER ROUND SELECT',    color: '#16a34a' },
		{ status: 'Recruiter Round Reject',   label: 'RECRUITER ROUND REJECT',    color: '#dc2626' },
		{ status: 'Education Capacity Round', label: 'EDUCATION CAPACITY ROUND',  color: '#1F497D' },
		{ status: 'Education Capacity Select',label: 'EDUCATION CAPACITY SELECT', color: '#16a34a' },
		{ status: 'Education Capacity Reject',label: 'EDUCATION CAPACITY REJECT', color: '#dc2626' },
		{ status: 'Subject Round',            label: 'SUBJECT ROUND',             color: '#1F497D' },
		{ status: 'Subject Round Select',     label: 'SUBJECT ROUND SELECT',      color: '#16a34a' },
		{ status: 'Subject Round Reject',     label: 'SUBJECT ROUND REJECT',      color: '#dc2626' },
		{ status: 'Functional Round',         label: 'FUNCTIONAL ROUND',          color: '#1F497D' },
		{ status: 'Functional Round Select',  label: 'FUNCTIONAL ROUND SELECT',   color: '#16a34a' },
		{ status: 'Functional Round Reject',  label: 'FUNCTIONAL ROUND REJECT',   color: '#dc2626' },
		{ status: 'Demo Round',               label: 'DEMO ROUND',                color: '#1F497D' },
		{ status: 'Demo Round Select',        label: 'DEMO ROUND SELECT',         color: '#16a34a' },
		{ status: 'Demo Round Reject',        label: 'DEMO ROUND REJECT',         color: '#dc2626' },
		{ status: 'Leader Round-1',           label: 'LEADER ROUND-1',            color: '#1F497D' },
		{ status: 'Leader Round-1 Select',    label: 'LEADER ROUND-1 SELECT',     color: '#16a34a' },
		{ status: 'Leader Round-1 Reject',    label: 'LEADER ROUND-1 REJECT',     color: '#dc2626' },
		{ status: 'Leader Round-2',           label: 'LEADER ROUND-2',            color: '#1F497D' },
		{ status: 'Leader Round-2 Select',    label: 'LEADER ROUND-2 SELECT',     color: '#16a34a' },
		{ status: 'Leader Round-2 Reject',    label: 'LEADER ROUND-2 REJECT',     color: '#dc2626' },
		{ status: 'Calibration Process',      label: 'CALIBRATION PROCESS',       color: '#1F497D' },
		{ status: 'Calibration Select',       label: 'CALIBRATION SELECT',        color: '#16a34a' },
		{ status: 'Calibration Reject',       label: 'CALIBRATION REJECT',        color: '#dc2626' },
		{ status: 'Document Verification Pass', label: 'DOCUMENT VERIFICATION PASS', color: '#16a34a' },
		{ status: 'Document Verification Fail', label: 'DOCUMENT VERIFICATION FAIL', color: '#dc2626' },
		{ status: 'Fitment Stage',            label: 'FITMENT STAGE',             color: '#1F497D' },
		{ status: 'Offer',                    label: 'OFFER',                     color: '#ca8a04' },
		{ status: 'Pre joining',              label: 'PRE JOINING',               color: '#ca8a04' },
		{ status: 'IT Team',                  label: 'IT TEAM',                   color: '#ca8a04' },
	];

	$(wrapper).find('.page-content').append(`
        <style>
            .recruit-filters {
                display: flex;
                gap: 12px;
                padding: 16px 20px 4px;
            }
            .recruit-filters select {
                flex: 1;
                padding: 7px 10px;
                border: 1px solid #d1d5db;
                border-radius: 6px;
                font-size: 13px;
                color: #111827;
                background: #fff;
                cursor: pointer;
            }
            .recruit-filters select:focus {
                outline: none;
                border-color: #2563eb;
            }
            .recruit-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 16px;
                padding: 16px 20px 20px;
            }
            .recruit-card {
                background: #fff;
                border: 1px solid #e5e7eb;
                border-radius: 10px;
                padding: 18px 20px;
                cursor: pointer;
                transition: box-shadow 0.25s, transform 0.25s, border-color 0.25s;
                position: relative;
                overflow: hidden;
            }
            .recruit-card::before {
                content: '';
                position: absolute;
                top: 0; left: 0; right: 0;
                height: 3px;
                background: var(--card-color, #7c3aed);
                transform: scaleX(0);
                transform-origin: left;
                transition: transform 0.3s ease;
            }
            .recruit-card:hover::before { transform: scaleX(1); }
            .recruit-card:hover {
                box-shadow: 0 6px 20px rgba(0,0,0,0.12);
                transform: translateY(-2px);
            }
            .recruit-card .card-count {
                animation: countPop 0.4s ease;
            }
            @keyframes countPop {
                0%   { transform: scale(0.7); opacity: 0; }
                70%  { transform: scale(1.15); }
                100% { transform: scale(1);   opacity: 1; }
            }
            .recruit-card .card-label {
                font-size: 11px;
                font-weight: 600;
                color: #6b7280;
                letter-spacing: 0.05em;
                margin-bottom: 8px;
            }
            .recruit-card .card-count {
                font-size: 32px;
                font-weight: 700;
            }
        </style>
        <div class="recruit-filters">
            <select id="filter-department"><option value="">All Departments</option></select>
            <select id="filter-role"><option value="">All Roles</option></select>
            <select id="filter-state"><option value="">All States</option></select>
            <select id="filter-district"><option value="">All Districts</option></select>
            <select id="filter-location"><option value="">All Locations</option></select>
        </div>
        <div class="recruit-grid" id="recruit-grid"></div>
    `);

	const $grid = $(wrapper).find('#recruit-grid');
	const $deptFilter = $(wrapper).find('#filter-department');
	const $roleFilter = $(wrapper).find('#filter-role');
	const $stateFilter = $(wrapper).find('#filter-state');
	const $distFilter = $(wrapper).find('#filter-district');
	const $locFilter = $(wrapper).find('#filter-location');

	// Render cards
	STATUS_CARDS.forEach(function (cfg) {
		$grid.append(`
            <div class="recruit-card" data-status="${cfg.status}" style="--card-color:${cfg.color}">
                <div class="card-label">${cfg.label}</div>
                <div class="card-count" style="color:${cfg.color}" id="count-${frappe.scrub(cfg.status)}">…</div>
            </div>
        `);
	});

	// 1. Populate Department dropdown from Field Department doctype
	frappe.call({
		method: 'frappe.client.get_list',
		args: { doctype: 'Field Department', fields: ['name'], limit_page_length: 0 },
		callback: function (r) {
			(r.message || []).sort(function (a, b) { return a.name.localeCompare(b.name); })
				.forEach(function (d) {
					$deptFilter.append(`<option value="${d.name}">${d.name}</option>`);
				});
		}
	});

	// 2. Populate Role dropdown from Field Role doctype
	frappe.call({
		method: 'frappe.client.get_list',
		args: { doctype: 'Field Role', fields: ['name'], limit_page_length: 0 },
		callback: function (r) {
			(r.message || []).sort(function (a, b) { return a.name.localeCompare(b.name); })
				.forEach(function (d) {
					$roleFilter.append(`<option value="${d.name}">${d.name}</option>`);
				});
		}
	});

	// 3. Populate State dropdown — hardcoded list
	[
		"Andaman Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar",
		"Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli", "Delhi", "Goa", "Gujarat",
		"Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala",
		"Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha",
		"Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
		"Uttar Pradesh", "Uttarakhand", "West Bengal", "Other"
	].forEach(function (s) {
		$stateFilter.append(`<option value="${s}">${s}</option>`);
	});

	// 4. Populate District dropdown — hardcoded list
	[
		"Adilabad", "Agar Malwa", "Agra", "Ahmadabad", "Ahmadnagar", "Aizawl", "Ajmer", "Akola",
		"Alappuzha", "Aligarh", "Alipurduar", "Alirajpur", "Allahabad", "Almora", "Alwar", "Ambala",
		"Ambedkar Nagar", "Amethi", "Amravati", "Amreli", "Amritsar", "Amroha", "Anand", "Anantapur",
		"Anjaw", "Anugul", "Anuppur", "Araria", "Ariyalur", "Arvalli", "Arwal", "Ashoknagar", "Auraiya",
		"Aurangabad", "Azamgarh", "Bagalkot", "Bageshwar", "Baghpat", "Bahraich", "Baksa", "Balaghat",
		"Balangir", "Baleshwar", "Ballia", "Balod", "Baloda Bazar", "Balrampur", "Banas Kantha", "Banda",
		"Bangalore", "Bangalore Rural", "Banka", "Bankura", "Banswara", "Bara Banki", "Baran",
		"Barddhaman", "Bareilly", "Bargarh", "Barmer", "Barnala", "Barpeta", "Barwani", "Bastar",
		"Basti", "Bathinda", "Baudh", "Begusarai", "Belgaum", "Bellary", "Bemetara", "Betul", "Bhadohi",
		"Bhadradri", "Bhadrak", "Bhagalpur", "Bhandara", "Bharatpur", "Bharuch", "Bhavnagar",
		"Bhilwara", "Bhind", "Bhiwani", "Bhojpur", "Bhopal", "Bid", "Bidar", "Bijapur", "Bijnor",
		"Bikaner", "Bilaspur", "Birbhum", "Bishnupur", "Biswanath", "Bokaro", "Bongaigaon", "Botad",
		"Budaun", "Bulandshahr", "Buldana", "Bundi", "Burhanpur", "Buxar", "Cachar", "Central",
		"Chamarajanagar", "Chamba", "Chamoli", "Champawat", "Champhai", "Chandauli", "Chandel",
		"Chandrapur", "Changlang", "Charaideo", "Charkhi Dadri", "Chatra", "Chennai", "Chhatarpur",
		"Chhindwara", "Chhota Udepur", "Chikkaballapura", "Chikmagalur", "Chirang", "Chitradurga",
		"Chitrakoot", "Chittaurgarh", "Chittoor", "Churachandpur", "Churu", "Coimbatore", "Cuddalore",
		"Cuttack", "Dakshin Bastar Dantewada", "Dakshin Dinajpur", "Dakshina Kannada", "Damoh",
		"Darbhanga", "Darjiling", "Darrang", "Datia", "Dausa", "Davanagere", "Debagarh", "Dehradun",
		"Deoghar", "Deoria", "Devbhoomi Dwarka", "Dewas", "Dhalai", "Dhamtari", "Dhanbad", "Dhar",
		"Dharmapuri", "Dharwad", "Dhaulpur", "Dhemaji", "Dhenkanal", "Dhubri", "Dhule", "Dibang Valley",
		"Dibrugarh", "Dima Hasao", "Dimapur", "Dindigul", "Dindori", "Dohad", "Dumka", "Dungarpur",
		"Durg", "East", "East District", "East Garo Hills", "East Godavari", "East Jaintia Hills",
		"East Kameng", "East Khasi Hills", "East Siang", "Ernakulam", "Erode", "Etah", "Etawah",
		"Faizabad", "Faridabad", "Faridkot", "Farrukhabad", "Fatehabad", "Fatehgarh Sahib", "Fatehpur",
		"Fazilka", "Firozabad", "Firozpur", "Gadag", "Gadchiroli", "Gajapati", "Gandhinagar", "Ganjam",
		"Garhwa", "Garhwal", "Gariyaband", "Gautam Buddha Nagar", "Gaya", "Ghaziabad", "Ghazipur",
		"Gir Somnath", "Giridih", "Goalpara", "Godda", "Golaghat", "Gomati", "Gonda", "Gondiya",
		"Gopalganj", "Gorakhpur", "Gulbarga", "Gumla", "Guna", "Guntur", "Gurdaspur", "Gurgaon",
		"Gwalior", "Hailakandi", "Hamirpur", "Hanumangarh", "Haora", "Hapur", "Harda", "Hardoi",
		"Hardwar", "Hassan", "Hathras", "Haveri", "Hazaribagh", "Hingoli", "Hisar", "Hojai",
		"Hoshangabad", "Hoshiarpur", "Hugli", "Hyderabad", "Idukki", "Imphal East", "Imphal West",
		"Indore", "Jabalpur", "Jagatsinghapur", "Jagtial", "Jaintia Hills", "Jaipur", "Jaisalmer",
		"Jajapur", "Jalandhar", "Jalaun", "Jalgaon", "Jalna", "Jalor", "Jalpaiguri", "Jamnagar",
		"Jamtara", "Jamui", "Jangaon", "Janjgir - Champa", "Jashpur", "Jaunpur", "Jayashankar",
		"Jehanabad", "Jhabua", "Jhajjar", "Jhalawar", "Jhansi", "Jhargram", "Jharsuguda", "Jhunjhunun",
		"Jind", "Jiribam", "Jodhpur", "Jogulamba", "Jorhat", "Junagadh", "Kabeerdham", "Kachchh",
		"Kaimur (Bhabua)", "Kaithal", "Kakching", "Kalahandi", "Kalimpong", "Kamareddy", "Kamjong",
		"Kamrup", "Kamrup Metropolitan", "Kancheepuram", "Kandhamal", "Kangpokpi", "Kangra",
		"Kannauj", "Kanniyakumari", "Kannur", "Kanpur Dehat", "Kanpur Nagar", "Kapurthala", "Karauli",
		"Karbi Anglong", "Karimganj", "Karimnagar", "Karnal", "Karur", "Kasaragod", "Kasganj",
		"Katihar", "Katni", "Kaushambi", "Kendrapara", "Kendujhar", "Khagaria", "Khammam",
		"Khandwa (East Nimar)", "Khargone (West Nimar)", "Kheda", "Kheri", "Khordha", "Khowai",
		"Khunti", "Kinnaur", "Kiphire", "Kishanganj", "Koch Bihar", "Kodagu", "Kodarma", "Kohima",
		"Kokrajhar", "Kolar", "Kolasib", "Kolhapur", "Kolkata", "Kollam", "Komaram Bheem", "Kondagaon",
		"Koppal", "Koraput", "Korba", "Koriya", "Kota", "Kottayam", "Kozhikode", "Kra Daadi", "Krishna",
		"Krishnagiri", "Kullu", "Kurnool", "Kurukshetra", "Kurung Kumey", "Kushinagar", "Lahul Spiti",
		"Lakhimpur", "Lakhisarai", "Lalitpur", "Latehar", "Latur", "Lawngtlai", "Lohardaga", "Lohit",
		"Longleng", "Lower Dibang Valley", "Lower Siang", "Lower Subansiri", "Lucknow", "Ludhiana",
		"Lunglei", "Madhepura", "Madhubani", "Madurai", "Mahabubabad", "Mahasamund", "Mahbubnagar",
		"Mahendragarh", "Mahesana", "Mahisagar", "Mahoba", "Mahrajganj", "Mainpuri", "Majuli",
		"Malappuram", "Maldah", "Malkangiri", "Mamit", "Mancherial", "Mandi", "Mandla", "Mandsaur",
		"Mandya", "Mansa", "Mathura", "Mau", "Mayurbhanj", "Medak", "Medchal-Malkajgiri", "Meerut",
		"Mewat", "Mirzapur", "Moga", "Mokokchung", "Mon", "Moradabad", "Morbi", "Morena", "Morigaon",
		"Muktsar", "Mumbai", "Mumbai Suburban", "Mungeli", "Munger", "Murshidabad", "Muzaffarnagar",
		"Muzaffarpur", "Mysore", "Nabarangapur", "Nadia", "Nagaon", "Nagapattinam", "Nagarkurnool",
		"Nagaur", "Nagpur", "Nainital", "Nalanda", "Nalbari", "Nalgonda", "Namakkal", "Namsai",
		"Nanded", "Nandurbar", "Narayanpur", "Narmada", "Narsimhapur", "Nashik", "Navsari", "Nawada",
		"Nayagarh", "Neemuch", "New Delhi", "Nirmal", "Nizamabad", "Noney", "North", "North  District",
		"North East", "North Garo Hills", "North Goa", "North Tripura", "North Twenty Four Parganas",
		"North West", "Nuapada", "Osmanabad", "Pakur", "Palakkad", "Palamu", "Palghar", "Pali", "Palwal",
		"Panch Mahals", "Panchkula", "Panipat", "Panna", "Papum Pare", "Parbhani", "Paschim Bardhaman",
		"Paschim Medinipur", "Pashchim Champaran", "Pashchimi Singhbhum", "Patan", "Pathanamthitta",
		"Pathankot", "Patiala", "Patna", "Peddapalli", "Perambalur", "Peren", "Phek", "Pherzawl",
		"Pilibhit", "Pithoragarh", "Porbandar", "Prakasam", "Pratapgarh", "Pudukkottai", "Pune",
		"Purba Bardhaman", "Purba Medinipur", "Purbi Champaran", "Purbi Singhbhum", "Puri", "Purnia",
		"Puruliya", "Rae Bareli", "Raichur", "Raigarh", "Raipur", "Raisen", "Rajanna", "Rajgarh",
		"Rajkot", "Rajnandgaon", "Rajsamand", "Ramanagara", "Ramanathapuram", "Ramgarh", "Rampur",
		"Ranchi", "Rangareddy", "Ratlam", "Ratnagiri", "Rayagada", "Rewa", "Rewari", "Ribhoi", "Rohtak",
		"Rohtas", "Rudraprayag", "Rupnagar", "Sagar", "Saharanpur", "Saharsa", "Sahibganj",
		"Sahibzada Ajit Singh Nagar", "Saiha", "Salem", "Samastipur", "Sambalpur", "Sambhal",
		"Sangareddy", "Sangli", "Sangrur", "Sant Kabir Nagar", "Saraikela-Kharsawan", "Saran",
		"Satara", "Satna", "Sawai Madhopur", "Sehore", "Senapati", "Seoni", "Sepahijala", "Serchhip",
		"Shahdara", "Shahdol", "Shahid Bhagat Singh Nagar", "Shahjahanpur", "Shajapur", "Shamli",
		"Sheikhpura", "Sheohar", "Sheopur", "Shimla", "Shimoga", "Shivpuri", "Shrawasti", "Siang",
		"Siddharthnagar", "Siddipet", "Sidhi", "Sikar", "Simdega", "Sindhudurg", "Singrauli",
		"Sirmaur", "Sirohi", "Sirsa", "Sitamarhi", "Sitapur", "Sivaganga", "Sivasagar", "Siwan",
		"Solan", "Solapur", "Sonbhadra", "Sonipat", "Sonitpur", "South", "South District",
		"South East Delhi", "South Garo Hills", "South Goa", "South Salamara-Mankachar",
		"South Tripura", "South Twenty Four Parganas", "South West", "South West Garo Hills",
		"South West Khasi Hills", "Sri Ganganagar", "Sri Potti Sriramulu Nellore", "Srikakulam",
		"Subarnapur", "Sukma", "Sultanpur", "Sundargarh", "Supaul", "Surajpur", "Surat", "Surendranagar",
		"Surguja", "Suryapet", "Tamenglong", "Tapi", "Tarn Taran", "Tawang", "Tehri Garhwal",
		"Tengnoupal", "Thane", "Thanjavur", "The Dangs", "The Nilgiris", "Theni", "Thiruvallur",
		"Thiruvananthapuram", "Thiruvarur", "Thoothukkudi", "Thoubal", "Thrissur", "Tikamgarh",
		"Tinsukia", "Tirap", "Tiruchirappalli", "Tirunelveli", "Tiruppur", "Tiruvannamalai", "Tonk",
		"Tuensang", "Tumkur", "Udaipur", "Udalguri", "Udham Singh Nagar", "Udupi", "Ujjain", "Ukhrul",
		"Umaria", "Una", "Unakoti", "Unnao", "Upper Siang", "Upper Subansiri", "Uttar Bastar Kanker",
		"Uttar Dinajpur", "Uttara Kannada", "Uttarkashi", "Vadodara", "Vaishali", "Valsad", "Varanasi",
		"Vellore", "Vidisha", "Vikarabad", "Viluppuram", "Virudhunagar", "Visakhapatnam", "Vizianagaram",
		"Wanaparthy", "Warangal Rural", "Warangal Urban", "Wardha", "Washim", "Wayanad", "West",
		"West District", "West Garo Hills", "West Godavari", "West Jaintia Hills", "West Kameng",
		"West Karbi Anglong", "West Khasi Hills", "West Siang", "West Tripura", "Wokha", "Y.S.R.",
		"Yadadri", "Yadgir", "Yamunanagar", "Yavatmal", "Zunheboto"
	].forEach(function (d) {
		$distFilter.append(`<option value="${d}">${d}</option>`);
	});

	// 5. Populate Location dropdown — hardcoded full district list
	[
		"Adilabad", "Agar Malwa", "Agra", "Ahmadabad", "Ahmadnagar", "Aizawl", "Ajmer", "Akola",
		"Alappuzha", "Aligarh", "Alipurduar", "Alirajpur", "Allahabad", "Almora", "Alwar", "Ambala",
		"Ambedkar Nagar", "Amethi", "Amravati", "Amreli", "Amritsar", "Amroha", "Anand", "Anantapur",
		"Anjaw", "Anugul", "Anuppur", "Araria", "Ariyalur", "Arvalli", "Arwal", "Ashoknagar", "Auraiya",
		"Aurangabad", "Azamgarh", "Bagalkot", "Bageshwar", "Baghpat", "Bahraich", "Baksa", "Balaghat",
		"Balangir", "Baleshwar", "Ballia", "Balod", "Baloda Bazar", "Balrampur", "Banas Kantha", "Banda",
		"Bangalore", "Bangalore Rural", "Banka", "Bankura", "Banswara", "Bara Banki", "Baran",
		"Barddhaman", "Bareilly", "Bargarh", "Barmer", "Barnala", "Barpeta", "Barwani", "Bastar",
		"Basti", "Bathinda", "Baudh", "Begusarai", "Belgaum", "Bellary", "Bemetara", "Betul", "Bhadohi",
		"Bhadradri", "Bhadrak", "Bhagalpur", "Bhandara", "Bharatpur", "Bharuch", "Bhavnagar",
		"Bhilwara", "Bhind", "Bhiwani", "Bhojpur", "Bhopal", "Bid", "Bidar", "Bijapur", "Bijnor",
		"Bikaner", "Bilaspur", "Birbhum", "Bishnupur", "Biswanath", "Bokaro", "Bongaigaon", "Botad",
		"Budaun", "Bulandshahr", "Buldana", "Bundi", "Burhanpur", "Buxar", "Cachar", "Central",
		"Chamarajanagar", "Chamba", "Chamoli", "Champawat", "Champhai", "Chandauli", "Chandel",
		"Chandrapur", "Changlang", "Charaideo", "Charkhi Dadri", "Chatra", "Chennai", "Chhatarpur",
		"Chhindwara", "Chhota Udepur", "Chikkaballapura", "Chikmagalur", "Chirang", "Chitradurga",
		"Chitrakoot", "Chittaurgarh", "Chittoor", "Churachandpur", "Churu", "Coimbatore", "Cuddalore",
		"Cuttack", "Dakshin Bastar Dantewada", "Dakshin Dinajpur", "Dakshina Kannada", "Damoh",
		"Darbhanga", "Darjiling", "Darrang", "Datia", "Dausa", "Davanagere", "Debagarh", "Dehradun",
		"Deoghar", "Deoria", "Devbhoomi Dwarka", "Dewas", "Dhalai", "Dhamtari", "Dhanbad", "Dhar",
		"Dharmapuri", "Dharwad", "Dhaulpur", "Dhemaji", "Dhenkanal", "Dhubri", "Dhule", "Dibang Valley",
		"Dibrugarh", "Dima Hasao", "Dimapur", "Dindigul", "Dindori", "Dohad", "Dumka", "Dungarpur",
		"Durg", "East", "East District", "East Garo Hills", "East Godavari", "East Jaintia Hills",
		"East Kameng", "East Khasi Hills", "East Siang", "Ernakulam", "Erode", "Etah", "Etawah",
		"Faizabad", "Faridabad", "Faridkot", "Farrukhabad", "Fatehabad", "Fatehgarh Sahib", "Fatehpur",
		"Fazilka", "Firozabad", "Firozpur", "Gadag", "Gadchiroli", "Gajapati", "Gandhinagar", "Ganjam",
		"Garhwa", "Garhwal", "Gariyaband", "Gautam Buddha Nagar", "Gaya", "Ghaziabad", "Ghazipur",
		"Gir Somnath", "Giridih", "Goalpara", "Godda", "Golaghat", "Gomati", "Gonda", "Gondiya",
		"Gopalganj", "Gorakhpur", "Gulbarga", "Gumla", "Guna", "Guntur", "Gurdaspur", "Gurgaon",
		"Gwalior", "Hailakandi", "Hamirpur", "Hanumangarh", "Haora", "Hapur", "Harda", "Hardoi",
		"Hardwar", "Hassan", "Hathras", "Haveri", "Hazaribagh", "Hingoli", "Hisar", "Hojai",
		"Hoshangabad", "Hoshiarpur", "Hugli", "Hyderabad", "Idukki", "Imphal East", "Imphal West",
		"Indore", "Jabalpur", "Jagatsinghapur", "Jagtial", "Jaintia Hills", "Jaipur", "Jaisalmer",
		"Jajapur", "Jalandhar", "Jalaun", "Jalgaon", "Jalna", "Jalor", "Jalpaiguri", "Jamnagar",
		"Jamtara", "Jamui", "Jangaon", "Janjgir - Champa", "Jashpur", "Jaunpur", "Jayashankar",
		"Jehanabad", "Jhabua", "Jhajjar", "Jhalawar", "Jhansi", "Jhargram", "Jharsuguda", "Jhunjhunun",
		"Jind", "Jiribam", "Jodhpur", "Jogulamba", "Jorhat", "Junagadh", "Kabeerdham", "Kachchh",
		"Kaimur (Bhabua)", "Kaithal", "Kakching", "Kalahandi", "Kalimpong", "Kamareddy", "Kamjong",
		"Kamrup", "Kamrup Metropolitan", "Kancheepuram", "Kandhamal", "Kangpokpi", "Kangra",
		"Kannauj", "Kanniyakumari", "Kannur", "Kanpur Dehat", "Kanpur Nagar", "Kapurthala", "Karauli",
		"Karbi Anglong", "Karimganj", "Karimnagar", "Karnal", "Karur", "Kasaragod", "Kasganj",
		"Katihar", "Katni", "Kaushambi", "Kendrapara", "Kendujhar", "Khagaria", "Khammam",
		"Khandwa (East Nimar)", "Khargone (West Nimar)", "Kheda", "Kheri", "Khordha", "Khowai",
		"Khunti", "Kinnaur", "Kiphire", "Kishanganj", "Koch Bihar", "Kodagu", "Kodarma", "Kohima",
		"Kokrajhar", "Kolar", "Kolasib", "Kolhapur", "Kolkata", "Kollam", "Komaram Bheem", "Kondagaon",
		"Koppal", "Koraput", "Korba", "Koriya", "Kota", "Kottayam", "Kozhikode", "Kra Daadi", "Krishna",
		"Krishnagiri", "Kullu", "Kurnool", "Kurukshetra", "Kurung Kumey", "Kushinagar", "Lahul Spiti",
		"Lakhimpur", "Lakhisarai", "Lalitpur", "Latehar", "Latur", "Lawngtlai", "Lohardaga", "Lohit",
		"Longleng", "Lower Dibang Valley", "Lower Siang", "Lower Subansiri", "Lucknow", "Ludhiana",
		"Lunglei", "Madhepura", "Madhubani", "Madurai", "Mahabubabad", "Mahasamund", "Mahbubnagar",
		"Mahendragarh", "Mahesana", "Mahisagar", "Mahoba", "Mahrajganj", "Mainpuri", "Majuli",
		"Malappuram", "Maldah", "Malkangiri", "Mamit", "Mancherial", "Mandi", "Mandla", "Mandsaur",
		"Mandya", "Mansa", "Mathura", "Mau", "Mayurbhanj", "Medak", "Medchal-Malkajgiri", "Meerut",
		"Mewat", "Mirzapur", "Moga", "Mokokchung", "Mon", "Moradabad", "Morbi", "Morena", "Morigaon",
		"Muktsar", "Mumbai", "Mumbai Suburban", "Mungeli", "Munger", "Murshidabad", "Muzaffarnagar",
		"Muzaffarpur", "Mysore", "Nabarangapur", "Nadia", "Nagaon", "Nagapattinam", "Nagarkurnool",
		"Nagaur", "Nagpur", "Nainital", "Nalanda", "Nalbari", "Nalgonda", "Namakkal", "Namsai",
		"Nanded", "Nandurbar", "Narayanpur", "Narmada", "Narsimhapur", "Nashik", "Navsari", "Nawada",
		"Nayagarh", "Neemuch", "New Delhi", "Nirmal", "Nizamabad", "Noney", "North", "North  District",
		"North East", "North Garo Hills", "North Goa", "North Tripura", "North Twenty Four Parganas",
		"North West", "Nuapada", "Osmanabad", "Pakur", "Palakkad", "Palamu", "Palghar", "Pali", "Palwal",
		"Panch Mahals", "Panchkula", "Panipat", "Panna", "Papum Pare", "Parbhani", "Paschim Bardhaman",
		"Paschim Medinipur", "Pashchim Champaran", "Pashchimi Singhbhum", "Patan", "Pathanamthitta",
		"Pathankot", "Patiala", "Patna", "Peddapalli", "Perambalur", "Peren", "Phek", "Pherzawl",
		"Pilibhit", "Pithoragarh", "Porbandar", "Prakasam", "Pratapgarh", "Pudukkottai", "Pune",
		"Purba Bardhaman", "Purba Medinipur", "Purbi Champaran", "Purbi Singhbhum", "Puri", "Purnia",
		"Puruliya", "Rae Bareli", "Raichur", "Raigarh", "Raipur", "Raisen", "Rajanna", "Rajgarh",
		"Rajkot", "Rajnandgaon", "Rajsamand", "Ramanagara", "Ramanathapuram", "Ramgarh", "Rampur",
		"Ranchi", "Rangareddy", "Ratlam", "Ratnagiri", "Rayagada", "Rewa", "Rewari", "Ribhoi", "Rohtak",
		"Rohtas", "Rudraprayag", "Rupnagar", "Sagar", "Saharanpur", "Saharsa", "Sahibganj",
		"Sahibzada Ajit Singh Nagar", "Saiha", "Salem", "Samastipur", "Sambalpur", "Sambhal",
		"Sangareddy", "Sangli", "Sangrur", "Sant Kabir Nagar", "Saraikela-Kharsawan", "Saran",
		"Satara", "Satna", "Sawai Madhopur", "Sehore", "Senapati", "Seoni", "Sepahijala", "Serchhip",
		"Shahdara", "Shahdol", "Shahid Bhagat Singh Nagar", "Shahjahanpur", "Shajapur", "Shamli",
		"Sheikhpura", "Sheohar", "Sheopur", "Shimla", "Shimoga", "Shivpuri", "Shrawasti", "Siang",
		"Siddharthnagar", "Siddipet", "Sidhi", "Sikar", "Simdega", "Sindhudurg", "Singrauli",
		"Sirmaur", "Sirohi", "Sirsa", "Sitamarhi", "Sitapur", "Sivaganga", "Sivasagar", "Siwan",
		"Solan", "Solapur", "Sonbhadra", "Sonipat", "Sonitpur", "South", "South District",
		"South East Delhi", "South Garo Hills", "South Goa", "South Salamara-Mankachar",
		"South Tripura", "South Twenty Four Parganas", "South West", "South West Garo Hills",
		"South West Khasi Hills", "Sri Ganganagar", "Sri Potti Sriramulu Nellore", "Srikakulam",
		"Subarnapur", "Sukma", "Sultanpur", "Sundargarh", "Supaul", "Surajpur", "Surat", "Surendranagar",
		"Surguja", "Suryapet", "Tamenglong", "Tapi", "Tarn Taran", "Tawang", "Tehri Garhwal",
		"Tengnoupal", "Thane", "Thanjavur", "The Dangs", "The Nilgiris", "Theni", "Thiruvallur",
		"Thiruvananthapuram", "Thiruvarur", "Thoothukkudi", "Thoubal", "Thrissur", "Tikamgarh",
		"Tinsukia", "Tirap", "Tiruchirappalli", "Tirunelveli", "Tiruppur", "Tiruvannamalai", "Tonk",
		"Tuensang", "Tumkur", "Udaipur", "Udalguri", "Udham Singh Nagar", "Udupi", "Ujjain", "Ukhrul",
		"Umaria", "Una", "Unakoti", "Unnao", "Upper Siang", "Upper Subansiri", "Uttar Bastar Kanker",
		"Uttar Dinajpur", "Uttara Kannada", "Uttarkashi", "Vadodara", "Vaishali", "Valsad", "Varanasi",
		"Vellore", "Vidisha", "Vikarabad", "Viluppuram", "Virudhunagar", "Visakhapatnam", "Vizianagaram",
		"Wanaparthy", "Warangal Rural", "Warangal Urban", "Wardha", "Washim", "Wayanad", "West",
		"West District", "West Garo Hills", "West Godavari", "West Jaintia Hills", "West Kameng",
		"West Karbi Anglong", "West Khasi Hills", "West Siang", "West Tripura", "Wokha", "Y.S.R.",
		"Yadadri", "Yadgir", "Yamunanagar", "Yavatmal", "Zunheboto"
	].forEach(function (loc) {
		$locFilter.append(`<option value="${loc}">${loc}</option>`);
	});

	// Load counts based on active filters
	function loadCounts() {
		STATUS_CARDS.forEach(function (cfg) {
			$(`#count-${frappe.scrub(cfg.status)}`).text('…');
		});

		const filters = [['name', '!=', '']];
		if ($deptFilter.val()) filters.push(['department', '=', $deptFilter.val()]);
		if ($roleFilter.val()) filters.push(['role', '=', $roleFilter.val()]);
		if ($stateFilter.val()) filters.push(['state', '=', $stateFilter.val()]);
		if ($distFilter.val()) filters.push(['district', '=', $distFilter.val()]);
		if ($locFilter.val()) filters.push(['location', '=', $locFilter.val()]);

		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Field Registration Form',
				fields: ['name', 'application_status'],
				filters: filters,
				limit_page_length: 0,
			},
			callback: function (r) {
				const records = r && r.message ? r.message : [];
				const counts = {};
				records.forEach(function (row) {
					const s = row.application_status || 'New Applicant';
					counts[s] = (counts[s] || 0) + 1;
				});
				STATUS_CARDS.forEach(function (cfg) {
					$(`#count-${frappe.scrub(cfg.status)}`).text(counts[cfg.status] || 0);
				});
			}
		});
	}

	// Re-load counts when filter changes
	$deptFilter.on('change', loadCounts);
	$roleFilter.on('change', loadCounts);
	$stateFilter.on('change', loadCounts);
	$distFilter.on('change', loadCounts);
	$locFilter.on('change', loadCounts);

	// Initial count load
	loadCounts();

	// Card click → open filtered list view
	$grid.on('click', '.recruit-card', function () {
		const status = $(this).data('status');
		let url = '/app/field-registration-form?application_status=' + encodeURIComponent(status);
		if ($deptFilter.val()) url += '&department=' + encodeURIComponent($deptFilter.val());
		if ($roleFilter.val()) url += '&role=' + encodeURIComponent($roleFilter.val());
		if ($stateFilter.val()) url += '&state=' + encodeURIComponent($stateFilter.val());
		if ($distFilter.val()) url += '&district=' + encodeURIComponent($distFilter.val());
		if ($locFilter.val()) url += '&location=' + encodeURIComponent($locFilter.val());
		window.location.href = url;
	});
};