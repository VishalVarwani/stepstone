const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config()


const app = express();
const PORT = process.env.STEPSTONEPORT

// Middleware
const corsOptions = {
    origin: ["http://localhost:3000"], // Replace with your frontend URL
    methods: ["GET", "POST"],
    credentials: true
};

app.use(cors(corsOptions));app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGO_URL_SCRAPING, { useNewUrlParser: true, useUnifiedTopology: true })

const jobSchema = new mongoose.Schema({
    title: String,
    company: String,
    location: String,
    description: String,
    link: String,
    jobPosted: String,
    imageSrc: String, 
    status: String
},  { collection: 'stepstonejobs' });
const Job = mongoose.models.StepStoneJob || mongoose.model('StepStoneJob', jobSchema);

// API key and base URLs
const apiKey = '20e627e4cb8068c6ec82d73c9f6c469f';
const baseUrl = 'https://www.stepstone.de/work/{jobTitle}/in-{location}?whereType=autosuggest&radius=30&page=';
const baseJobLink = 'https://www.stepstone.de';

// Function to scrape a single page
async function scrapePage(pageNumber, jobTitle, location) {
    const targetUrl = baseUrl
        .replace('{jobTitle}', encodeURIComponent(jobTitle))
        .replace('{location}', encodeURIComponent(location))
        + pageNumber;

    const scraperApiUrl = `http://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&premium=true`;

    try {
        const response = await axios.get(scraperApiUrl);
        if (response.status === 200) {
            const $ = cheerio.load(response.data);

            // Extract job details
            const locations = $('span.res-1qh7elo').map((_, el) => $(el).text().replace(/Partially remote/i, '').trim()).get();
            const companies = $('span.res-1fad2gj').map((_, el) => $(el).text().replace(/Show salary/i, '').trim()).get();
            const jobRoles = $('h2.res-1tassqi').map((_, el) => $(el).text().trim()).get();
            const descriptions = $('span.res-jj48go').map((_, el) => $(el).text().trim()).get();
            const daysPosted = $('span.res-9ochkb').map((_, el) => $(el).text().trim()).get();
            const status = $('span.res-idckf7').map((_, el) => $(el).text().trim()).get();

            const jobLinks = $('a.res-1foik6i').map((_, el) => baseJobLink + $(el).attr('href')).get();
            const imageSources = $('div.res-13wvw69').map((_, el) => {
                const noscriptTag = $(el).find('noscript');
                if (noscriptTag.length > 0) {
                    const imgTag = cheerio.load(noscriptTag.html())('img');
                    return imgTag.attr('src');
                }
                return null;
            }).get();
            // Create an array of job objects
            const jobs = jobRoles.map((role, index) => ({
                title: role || null,
                company: companies[index] || null,
                location: locations[index] || null,
                description: descriptions[index] || null,
                link: jobLinks[index] || null,
                jobPosted: daysPosted[index] || null,
                imageSrc: imageSources[index] || null,
                status: status[index] || null
                

            }));

            // Remove jobs with null Company or Location
            return jobs.filter(job => job.company && job.location);
        } else {
            console.error(`Failed to retrieve page ${pageNumber}. Status code: ${response.status}`);
            return [];
        }
    } catch (error) {
        console.error(`An error occurred while scraping page ${pageNumber}:`, error.message);
        return [];
    }
}

// Function to scrape multiple pages
// Function to scrape with a limit on concurrency
const scrapeStepstonePagesConcurrently = async (jobTitle, location, startPage, endPage, maxWorkers = 5) => {
    const pageNumbers = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);
  
    const workerTasks = pageNumbers.map((page) => scrapePage(jobTitle, location, page));
    const results = await Promise.all(workerTasks);
  
    // Flatten the results
    return results.flat();
  };

app.post('/fetch-jobs', async (req, res) => {
  const jobTitle = req.body.job_title || 'developer';
  const location = req.body.location || 'germany';
  const startPage = 1;
  const endPage = 10;

  try {
    const jobs = await scrapeStepstonePagesConcurrently(jobTitle, location, startPage, endPage);

    // Clear previous jobs and save new ones
    await Job.deleteMany({});
    await Job.insertMany(jobs);

    res.json({ message: 'Job fetching completed', jobCount: jobs.length });
  } catch (error) {
    console.error('Error fetching jobs:', error);
    res.status(500).json({ error: 'Failed to fetch jobs. Please try again.' });
  }
});

app.get('/stepstone-get-jobs', async (req, res) => {
  try {
      const jobs = await Job.find({}, { _id: 0 });
      res.json(jobs);
  } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error fetching job listings. Please try again.' });
  }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
